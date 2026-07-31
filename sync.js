"use strict";

    function createEmbeddedSupabaseClient(url, publishableKey) {
      const authListeners = new Set();
      let refreshPromise = null;

      function makeError(message, details = null) {
        return {
          message:
            message ||
            "Supabaseとの通信中にエラーが発生しました。",
          details
        };
      }

      function readSession() {
        try {
          const raw =
            localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);

          if (!raw) return null;

          const session = JSON.parse(raw);

          if (
            !session ||
            !session.access_token ||
            !session.refresh_token ||
            !session.user
          ) {
            return null;
          }

          return session;
        } catch {
          return null;
        }
      }

      function saveSession(session) {
        if (!session) return null;

        const normalized = {
          ...session,
          expires_at:
            Number(session.expires_at) ||
            Math.floor(Date.now() / 1000) +
              Number(session.expires_in || 3600)
        };

        localStorage.setItem(
          SUPABASE_AUTH_STORAGE_KEY,
          JSON.stringify(normalized)
        );

        return normalized;
      }

      function clearSession() {
        localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      }

      function notifyAuthListeners(event, session) {
        for (const listener of authListeners) {
          try {
            listener(event, session);
          } catch (error) {
            console.error(error);
          }
        }
      }

      async function parseResponse(response) {
        const text = await response.text();
        let body = null;

        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }

        if (response.ok) {
          return { data: body, error: null };
        }

        const message =
          body?.message ||
          body?.msg ||
          body?.error_description ||
          body?.error ||
          (typeof body === "string" ? body : "") ||
          `通信に失敗しました（${response.status}）`;

        return {
          data: null,
          error: makeError(message, body)
        };
      }

      async function authRequest(path, options = {}) {
        try {
          const response = await fetch(
            `${url}/auth/v1/${path}`,
            {
              ...options,
              headers: {
                apikey: publishableKey,
                "Content-Type": "application/json",
                ...(options.headers || {})
              }
            }
          );

          return parseResponse(response);
        } catch (error) {
          return {
            data: null,
            error: makeError(
              "Supabaseへ接続できませんでした。通信状態を確認してください。",
              error
            )
          };
        }
      }

      async function refreshSession() {
        if (refreshPromise) return refreshPromise;

        refreshPromise = (async () => {
          const stored = readSession();

          if (!stored?.refresh_token || !stored?.user) {
            clearSession();
            notifyAuthListeners("SIGNED_OUT", null);
            return {
              data: { session: null, user: null },
              error: null
            };
          }

          const result = await authRequest(
            "token?grant_type=refresh_token",
            {
              method: "POST",
              body: JSON.stringify({
                refresh_token: stored.refresh_token
              })
            }
          );

          if (result.error || !result.data?.access_token) {
            // 圏外や一時的な通信不良でも、保存済みログインは消さない。
            notifyAuthListeners(
              "TOKEN_REFRESH_FAILED",
              stored
            );

            return {
              data: {
                session: stored,
                user: stored.user,
                stale: true
              },
              error:
                result.error ||
                makeError(
                  "ログイン情報を更新できませんでした。"
                )
            };
          }

          const session = saveSession({
            ...result.data,
            refresh_token:
              result.data.refresh_token ||
              stored.refresh_token
          });

          notifyAuthListeners(
            "TOKEN_REFRESHED",
            session
          );

          return {
            data: {
              session,
              user: session.user
            },
            error: null
          };
        })();

        try {
          return await refreshPromise;
        } finally {
          refreshPromise = null;
        }
      }

      async function getValidSession() {
        const session = readSession();

        if (!session) {
          return {
            data: { session: null, user: null },
            error: null
          };
        }

        const expiresAt =
          Number(session.expires_at) || 0;
        const now =
          Math.floor(Date.now() / 1000);

        if (expiresAt > now + 90) {
          return {
            data: {
              session,
              user: session.user
            },
            error: null
          };
        }

        return refreshSession();
      }

      async function authorizedRequest(
        path,
        options = {}
      ) {
        const sessionResult =
          await getValidSession();
        const session =
          sessionResult.data?.session;

        if (!session?.access_token) {
          return {
            data: null,
            error:
              sessionResult.error ||
              makeError(
                "ログインが切れました。もう一度ログインしてください。"
              )
          };
        }

        try {
          const response = await fetch(
            `${url}/rest/v1/${path}`,
            {
              ...options,
              headers: {
                apikey: publishableKey,
                Authorization:
                  `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
                ...(options.headers || {})
              }
            }
          );

          return parseResponse(response);
        } catch (error) {
          return {
            data: null,
            error: makeError(
              "クラウドへ接続できませんでした。通信状態を確認してください。",
              error
            )
          };
        }
      }

      function from(tableName) {
        const table =
          encodeURIComponent(tableName);

        return {
          async upsert(payload, options = {}) {
            const conflict =
              options.onConflict
                ? `?on_conflict=${encodeURIComponent(
                    options.onConflict
                  )}`
                : "";

            const result =
              await authorizedRequest(
                `${table}${conflict}`,
                {
                  method: "POST",
                  headers: {
                    Prefer:
                      "resolution=merge-duplicates,return=minimal"
                  },
                  body: JSON.stringify(payload)
                }
              );

            return {
              data: result.data,
              error: result.error
            };
          },

          select(columns = "*") {
            const filters = [];

            return {
              eq(column, value) {
                filters.push(
                  `${encodeURIComponent(column)}=eq.${encodeURIComponent(
                    String(value)
                  )}`
                );
                return this;
              },

              async maybeSingle() {
                const query = [
                  `select=${encodeURIComponent(columns)}`,
                  ...filters,
                  "limit=1"
                ].join("&");

                const result =
                  await authorizedRequest(
                    `${table}?${query}`,
                    { method: "GET" }
                  );

                if (result.error) {
                  return {
                    data: null,
                    error: result.error
                  };
                }

                const rows =
                  Array.isArray(result.data)
                    ? result.data
                    : [];

                return {
                  data: rows[0] || null,
                  error: null
                };
              }
            };
          }
        };
      }

      const auth = {
        async signInWithPassword({ email, password }) {
          const result = await authRequest(
            "token?grant_type=password",
            {
              method: "POST",
              body: JSON.stringify({
                email,
                password
              })
            }
          );

          if (
            result.error ||
            !result.data?.access_token
          ) {
            return {
              data: {
                user: null,
                session: null
              },
              error:
                result.error ||
                makeError(
                  "ログインできませんでした。"
                )
            };
          }

          const session =
            saveSession(result.data);

          notifyAuthListeners(
            "SIGNED_IN",
            session
          );

          return {
            data: {
              user: session.user,
              session
            },
            error: null
          };
        },

        async signOut() {
          const session = readSession();

          if (session?.access_token) {
            try {
              await authRequest("logout", {
                method: "POST",
                headers: {
                  Authorization:
                    `Bearer ${session.access_token}`
                }
              });
            } catch {
              // 通信できなくても端末側ではログアウトする
            }
          }

          clearSession();
          notifyAuthListeners(
            "SIGNED_OUT",
            null
          );

          return { error: null };
        },

        async getSession() {
          return getValidSession();
        },

        onAuthStateChange(callback) {
          authListeners.add(callback);

          return {
            data: {
              subscription: {
                unsubscribe() {
                  authListeners.delete(callback);
                }
              }
            }
          };
        }
      };

      setInterval(() => {
        getValidSession().catch(console.error);
      }, 60 * 1000);

      return { auth, from };
    }

    let supabaseClient = createEmbeddedSupabaseClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    );
    let currentSyncUser = null;
    let cloudSyncTimer = null;
    let applyingCloudState = false;
    let activeUserSetupPromise = null;

    function setSyncState(status, message = "") {
      syncStatusButton.dataset.status = status;

      const titles = {
        offline: "この端末だけに保存",
        syncing: "同期中",
        synced: "クラウドと同期済み",
        error: "同期エラー"
      };

      syncStatusButton.title = titles[status] || titles.offline;
      syncStatusButton.setAttribute(
        "aria-label",
        `${syncStatusButton.title}。同期設定を開く`
      );

      syncStateText.textContent = message || syncStatusButton.title;
      syncStateText.classList.toggle("error", status === "error");
    }

    function showSyncPanels(isSignedIn) {
      signedOutSyncPanel.hidden = isSignedIn;
      signedInSyncPanel.hidden = !isSignedIn;

      if (isSignedIn && currentSyncUser) {
        syncAccount.textContent =
          `ログイン中：${currentSyncUser.email || "ユーザー"}`;
      } else {
        syncAccount.textContent = "";
      }
    }

    function openSyncDialog() {
      syncOverlay.hidden = false;
      document.body.classList.add("sync-dialog-open");
      showSyncPanels(Boolean(currentSyncUser));

      if (!currentSyncUser) {
        syncEmail.focus();
      }
    }

    function closeSyncDialog() {
      syncOverlay.hidden = true;
      document.body.classList.remove("sync-dialog-open");
    }

    function collectLocalState() {
      const data = {
        version: 1,
        saved_at: new Date().toISOString()
      };

      for (const key of CLOUD_STORAGE_KEYS) {
        data[key] = loadArray(key);
      }

      return data;
    }

    function renderAllStoredData() {
      renderSchedule();
      renderTaskRecords();
      renderWorkHistory();
    }

    function normalizeCloudState(value) {
      if (!value) return null;

      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }

      return typeof value === "object" ? value : null;
    }

    function countStoredState(state) {
      const normalized = normalizeCloudState(state) || {};

      const taskCount = Array.isArray(
        normalized[TASK_STORAGE_KEY]
      )
        ? normalized[TASK_STORAGE_KEY].length
        : 0;

      const restCount = Array.isArray(
        normalized[RECOVERY_STORAGE_KEY]
      )
        ? normalized[RECOVERY_STORAGE_KEY].length
        : 0;

      const workCount = Array.isArray(
        normalized[WORK_STORAGE_KEY]
      )
        ? normalized[WORK_STORAGE_KEY].length
        : 0;

      const scheduleCount = Array.isArray(
        normalized[SCHEDULE_STORAGE_KEY]
      )
        ? normalized[SCHEDULE_STORAGE_KEY].length
        : 0;

      return {
        taskCount,
        restCount,
        workCount,
        scheduleCount,
        total:
          taskCount +
          restCount +
          workCount +
          scheduleCount
      };
    }

    function describeStoredState(state) {
      const counts = countStoredState(state);
      const parts = [];

      if (counts.workCount > 0) {
        parts.push(`作業${counts.workCount}件`);
      }

      if (counts.scheduleCount > 0) {
        parts.push(`1日の管理${counts.scheduleCount}件`);
      }

      if (counts.taskCount > 0) {
        parts.push(`積み重ね${counts.taskCount}件`);
      }

      if (counts.restCount > 0) {
        parts.push(`過去の休憩${counts.restCount}件`);
      }

      return parts.length > 0
        ? parts.join("・")
        : "記録0件";
    }

    function saveLocalSafetyBackup() {
      try {
        localStorage.setItem(
          "tsumikasane-before-cloud-restore-v1",
          JSON.stringify({
            backed_up_at: new Date().toISOString(),
            data: collectLocalState()
          })
        );
      } catch (error) {
        console.error(error);
      }
    }

    function applyCloudState(cloudData) {
      const normalized =
        normalizeCloudState(cloudData);

      if (!normalized) {
        throw new Error(
          "クラウドの記録形式を読み取れませんでした。"
        );
      }

      saveLocalSafetyBackup();
      applyingCloudState = true;

      try {
        for (const key of CLOUD_STORAGE_KEYS) {
          const records = normalized[key];

          localStorage.setItem(
            key,
            JSON.stringify(
              Array.isArray(records) ? records : []
            )
          );
        }

        localStorage.setItem(
          LOCAL_UPDATED_AT_KEY,
          normalized.saved_at ||
            new Date().toISOString()
        );
      } finally {
        applyingCloudState = false;
      }

      renderAllStoredData();
      return countStoredState(normalized);
    }

    function scheduleCloudSync() {
      if (
        !currentSyncUser ||
        !supabaseClient ||
        applyingCloudState
      ) {
        return;
      }

      clearTimeout(cloudSyncTimer);
      setSyncState("syncing", "変更をクラウドへ保存しています…");

      cloudSyncTimer = setTimeout(() => {
        pushLocalStateToCloud();
      }, 700);
    }

    async function fetchCloudState() {
      if (!currentSyncUser || !supabaseClient) {
        return {
          data: null,
          error: {
            message: "ログインしていません。"
          }
        };
      }

      return supabaseClient
        .from("app_state")
        .select("data, updated_at")
        .eq("user_id", currentSyncUser.id)
        .maybeSingle();
    }

    async function pushLocalStateToCloud() {
      if (!currentSyncUser || !supabaseClient) return false;

      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
      setSyncState("syncing", "クラウドへ保存しています…");

      const snapshot = collectLocalState();
      const localCounts = countStoredState(snapshot);
      const cloudResult = await fetchCloudState();

      if (cloudResult.error) {
        console.error(cloudResult.error);
        setSyncState(
          "error",
          `保存前の確認に失敗しました：${cloudResult.error.message}`
        );
        return false;
      }

      const cloudState =
        normalizeCloudState(cloudResult.data?.data);
      const cloudCounts =
        countStoredState(cloudState);

      if (
        localCounts.total === 0 &&
        cloudCounts.total > 0
      ) {
        setSyncState(
          "error",
          `端末の記録が空なので保存を止めました。クラウドには${describeStoredState(cloudState)}残っています。先に「クラウドから記録を復元」を押してください。`
        );
        return false;
      }

      const { error } = await supabaseClient
        .from("app_state")
        .upsert(
          {
            user_id: currentSyncUser.id,
            data: snapshot,
            updated_at: new Date().toISOString()
          },
          { onConflict: "user_id" }
        );

      if (error) {
        console.error(error);
        setSyncState(
          "error",
          `保存できませんでした：${error.message}`
        );
        return false;
      }

      setSyncState(
        "synced",
        `${describeStoredState(snapshot)}をクラウドへ保存しました。`
      );
      return true;
    }

    async function pullCloudState() {
      if (!currentSyncUser || !supabaseClient) return false;

      setSyncState(
        "syncing",
        "クラウドの記録を確認しています…"
      );

      const { data, error } =
        await fetchCloudState();

      if (error) {
        console.error(error);
        setSyncState(
          "error",
          `読み込めませんでした：${error.message}`
        );
        return false;
      }

      if (!data) {
        setSyncState(
          "synced",
          "クラウドに保存された記録はありません。端末のデータを自動保存せず待機しています。"
        );
        return true;
      }

      const cloudState =
        normalizeCloudState(data.data);

      if (!cloudState) {
        setSyncState(
          "error",
          "クラウドの記録形式を読み取れませんでした。"
        );
        return false;
      }

      const counts =
        countStoredState(cloudState);

      if (counts.total === 0) {
        setSyncState(
          "synced",
          "クラウドの記録は空です。端末の状態は変更していません。"
        );
        return true;
      }

      try {
        applyCloudState(cloudState);
      } catch (errorApply) {
        console.error(errorApply);
        setSyncState(
          "error",
          `復元できませんでした：${errorApply.message}`
        );
        return false;
      }

      setSyncState(
        "synced",
        `${describeStoredState(cloudState)}をクラウドから復元しました。`
      );
      return true;
    }

    async function handleSignedIn(user) {
      if (!user) return;

      if (
        currentSyncUser?.id === user.id &&
        activeUserSetupPromise
      ) {
        return activeUserSetupPromise;
      }

      currentSyncUser = user;
      showSyncPanels(true);

      activeUserSetupPromise = pullCloudState();

      const result = await activeUserSetupPromise;
      activeUserSetupPromise = null;
      return result;
    }

    function handleSignedOut() {
      currentSyncUser = null;
      activeUserSetupPromise = null;
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
      showSyncPanels(false);
      setSyncState(
        "offline",
        "ログインすると、計画や記録をほかの端末と共有できます。"
      );
    }

    async function signInForSync() {
      if (!supabaseClient) {
        supabaseClient =
          createEmbeddedSupabaseClient(
            SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY
          );
      }

      const email = syncEmail.value.trim();
      const password = syncPassword.value;

      if (!email || !password) {
        setSyncState(
          "error",
          "メールアドレスとパスワードを入力してください。"
        );
        return;
      }

      signInSyncButton.disabled = true;
      setSyncState("syncing", "ログインしています…");

      const { data, error } =
        await supabaseClient.auth.signInWithPassword({
          email,
          password
        });

      signInSyncButton.disabled = false;

      if (error) {
        console.error(error);
        setSyncState(
          "error",
          `ログインできませんでした：${error.message}`
        );
        return;
      }

      syncPassword.value = "";
      await handleSignedIn(data.user);
      closeSyncDialog();
    }

    async function signOutFromSync() {
      if (!supabaseClient) return;

      setSyncState("syncing", "ログアウトしています…");
      const { error } = await supabaseClient.auth.signOut();

      if (error) {
        setSyncState(
          "error",
          `ログアウトできませんでした：${error.message}`
        );
        return;
      }

      handleSignedOut();
    }

    async function initializeCloudSync() {
      if (!supabaseClient) {
        supabaseClient =
          createEmbeddedSupabaseClient(
            SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY
          );
      }

      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          handleSignedOut();
          return;
        }

        if (!session?.user) return;

        if (event === "TOKEN_REFRESH_FAILED") {
          currentSyncUser = session.user;
          showSyncPanels(true);
          setSyncState(
            "offline",
            "ログインは保持中です。通信が戻ると自動で同期します。"
          );
          return;
        }

        if (
          ["SIGNED_IN", "TOKEN_REFRESHED"].includes(event) &&
          currentSyncUser?.id !== session.user.id
        ) {
          handleSignedIn(session.user);
        }
      });

      const {
        data: { session },
        error
      } = await supabaseClient.auth.getSession();

      if (session?.user) {
        if (error) {
          console.error(error);
          currentSyncUser = session.user;
          showSyncPanels(true);
          setSyncState(
            "offline",
            "ログインは保持中です。通信が戻ると自動で同期します。"
          );
          return;
        }

        await handleSignedIn(session.user);
        return;
      }

      if (error) {
        console.error(error);
        setSyncState(
          "error",
          `ログイン状態を確認できませんでした：${error.message}`
        );
        return;
      }

      handleSignedOut();
    }

    async function resumeCloudSession() {
      if (!supabaseClient) return;

      const {
        data: { session },
        error
      } = await supabaseClient.auth.getSession();

      if (session?.user) {
        currentSyncUser = session.user;
        showSyncPanels(true);

        if (error) {
          setSyncState(
            "offline",
            "ログインは保持中です。通信が戻ると自動で同期します。"
          );
          return;
        }

        await pullCloudState();
      }
    }

    function initSyncFeature() {
      bindEvent(syncStatusButton, "click", openSyncDialog);
      bindEvent(closeSyncButton, "click", closeSyncDialog);
      bindEvent(syncOverlay, "click", event => {
        if (event.target === syncOverlay) closeSyncDialog();
      });
      bindEvent(signInSyncButton, "click", signInForSync);
      bindEvent(signOutSyncButton, "click", signOutFromSync);
      bindEvent(refreshFromCloudButton, "click", pullCloudState);
      bindEvent(saveToCloudButton, "click", pushLocalStateToCloud);
      bindEvent(syncPassword, "keydown", event => {
        if (event.key === "Enter") signInForSync();
      });
      bindEvent(document, "keydown", event => {
        if (event.key === "Escape" && syncOverlay && !syncOverlay.hidden) {
          closeSyncDialog();
        }
      });
      bindEvent(window, "pageshow", resumeCloudSession);
      bindEvent(window, "online", resumeCloudSession);
      return initializeCloudSync();
    }
