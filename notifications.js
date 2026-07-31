"use strict";

    function isIOSDevice() {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (
          navigator.platform === "MacIntel" &&
          navigator.maxTouchPoints > 1
        );
    }

    function isStandaloneApp() {
      return window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
    }

    function notificationUnavailableReason() {
      if (isIOSDevice() && !isStandaloneApp()) {
        return "iPhoneでは、Safariからホーム画面に追加したアプリを開いて通知を設定してください。";
      }

      if (!("Notification" in window)) {
        return "このブラウザでは通知機能を利用できません。";
      }

      if (!("serviceWorker" in navigator)) {
        return "このブラウザでは通知に必要なService Workerを利用できません。";
      }

      return "";
    }

    function setNotificationStatus(message) {
      notificationSettingsStatus.textContent = message;
    }

    function updateNotificationSettingsUI() {
      openSoundToggle.checked = Boolean(timerSettings.soundEnabled);
      openVibrationToggle.checked =
        Boolean(timerSettings.vibrationEnabled);
      systemNotificationToggle.checked =
        Boolean(timerSettings.systemNotificationsEnabled);
      notificationCountSelect.value =
        String(timerSettings.notificationCount || 1);
      repeatNotificationToggle.checked =
        Boolean(timerSettings.repeatNotifications);
      alertSoundSelect.value = timerSettings.soundType || "soft";

      updateNextWorkChoiceUI();

      // 押せない状態にせず、タップした時に理由を表示する。
      systemNotificationToggle.disabled = false;
      requestNotificationButton.disabled = false;

      const unavailableReason = notificationUnavailableReason();

      if (unavailableReason) {
        requestNotificationButton.textContent = "通知を使える状態にする";
        setNotificationStatus(unavailableReason);
        return;
      }

      const permission = Notification.permission;

      if (permission === "granted") {
        requestNotificationButton.textContent = "通知は許可されています";
        setNotificationStatus(
          timerSettings.systemNotificationsEnabled
            ? "通知を利用中です。下のテストで確認できます。"
            : "通知は許可済みです。「通知を使う」をオンにしてください。"
        );
      } else if (permission === "denied") {
        requestNotificationButton.textContent = "通知設定を確認する";
        setNotificationStatus(
          "通知が拒否されています。iPhoneの設定 → 通知 → Shunta Appから許可してください。"
        );
      } else {
        requestNotificationButton.textContent = "通知を許可する";
        setNotificationStatus(
          "「通知を使う」または「通知を許可する」を押してください。"
        );
      }
    }

    window.updateShuntaNotificationSettingsUI =
      updateNotificationSettingsUI;

    function openNotificationSettings() {
      updateNotificationSettingsUI();
      notificationSettingsOverlay.hidden = false;
      document.body.style.overflow = "hidden";
    }

    function closeNotificationSettings() {
      notificationSettingsOverlay.hidden = true;

      if (
        activeTimerPanel.hidden &&
        timerDecisionPanel.hidden
      ) {
        document.body.style.overflow = "";
      }
    }

    function updateNextWorkChoiceUI() {
      for (const button of nextWorkChoiceButtons) {
        const selected =
          Number(button.dataset.nextWorkMinutes) ===
          Number(timerSettings.nextWorkMinutes);

        button.setAttribute("aria-pressed", String(selected));
      }

    }

    function selectNextWorkMinutes(minutes) {
      timerSettings.nextWorkMinutes = Number(minutes) || 25;
      timerSettings.autoStartNextWork = true;
      saveTimerSettings();
      updateNextWorkChoiceUI();
    }

    function primeAlertAudio() {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return;

      if (!audioContext) {
        audioContext = new AudioContextClass();
      }

      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
    }

    function playTone(frequency, startDelay, duration, volume = 0.12) {
      if (!audioContext) return;

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime + startDelay;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, volume),
        startAt + 0.02
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + duration
      );

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.03);
    }

    function playAlertSound() {
      if (!timerSettings.soundEnabled) return;

      primeAlertAudio();
      if (!audioContext) return;

      const type = timerSettings.soundType || "soft";

      if (type === "bell") {
        playTone(880, 0, 0.22, 0.15);
        playTone(1320, 0.12, 0.35, 0.12);
      } else if (type === "bird") {
        playTone(740, 0, 0.12, 0.1);
        playTone(990, 0.14, 0.12, 0.1);
        playTone(820, 0.29, 0.18, 0.09);
      } else {
        playTone(523.25, 0, 0.3, 0.09);
        playTone(659.25, 0.2, 0.42, 0.08);
      }
    }

    function vibrateAlert() {
      if (!timerSettings.vibrationEnabled) return false;
      if (!navigator.vibrate) return false;

      return navigator.vibrate([180, 100, 180]);
    }

    async function registerNotificationServiceWorker() {
      if (!("serviceWorker" in navigator)) return null;

      try {
        const registration =
          await navigator.serviceWorker.register(
            "./service-worker.js",
            {
              scope: "./",
              updateViaCache: "none"
            }
          );

        await registration.update();
        return registration;
      } catch (error) {
        console.error("Service worker registration failed", error);
        return null;
      }
    }

    async function requestNotificationPermission() {
      const unavailableReason = notificationUnavailableReason();

      if (unavailableReason) {
        timerSettings.systemNotificationsEnabled = false;
        systemNotificationToggle.checked = false;
        saveTimerSettings();
        setNotificationStatus(unavailableReason);
        return false;
      }

      if (Notification.permission === "denied") {
        timerSettings.systemNotificationsEnabled = false;
        systemNotificationToggle.checked = false;
        saveTimerSettings();
        setNotificationStatus(
          "通知が拒否されています。iPhoneの設定 → 通知 → Shunta Appから許可してください。"
        );
        return false;
      }

      try {
        // iPhoneでは、許可要求をタップ操作の直後に実行する必要がある。
        // Service Worker登録などの非同期処理より先に許可画面を出す。
        const permission =
          Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();

        if (permission !== "granted") {
          timerSettings.systemNotificationsEnabled = false;
          systemNotificationToggle.checked = false;
          saveTimerSettings();
          updateNotificationSettingsUI();
          setNotificationStatus(
            "通知が許可されませんでした。端末の通知設定を確認してください。"
          );
          return false;
        }

        setNotificationStatus("通知機能を準備しています…");

        const registration =
          await registerNotificationServiceWorker();

        if (!registration) {
          throw new Error("Service Workerを登録できませんでした。");
        }

        await navigator.serviceWorker.ready;

        timerSettings.systemNotificationsEnabled = true;
        systemNotificationToggle.checked = true;
        saveTimerSettings();
        updateNotificationSettingsUI();

        setNotificationStatus(
          "通知をオンにしました。下の通知テストで確認してください。"
        );
        return true;
      } catch (error) {
        console.error(error);
        timerSettings.systemNotificationsEnabled = false;
        systemNotificationToggle.checked = false;
        saveTimerSettings();
        setNotificationStatus(
          `通知を設定できませんでした：${error.message || error}`
        );
        return false;
      }
    }

    async function showSystemNotification(title, body, tag = "timer") {
      if (
        !timerSettings.systemNotificationsEnabled ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
      ) {
        return false;
      }

      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(title, {
            body,
            icon: "./icon-192.png",
            badge: "./icon-192.png",
            tag,
            renotify: true
          });
          return true;
        }

        return false;
      } catch (error) {
        console.error("Notification failed", error);
        return false;
      }
    }

    let completionSoundTimers = [];

    function playCompletionAlertSequence() {
      for (const timerId of completionSoundTimers) {
        clearTimeout(timerId);
      }

      completionSoundTimers = [];

      for (const delay of [0, 3000, 6000]) {
        const timerId = setTimeout(() => {
          playAlertSound();
        }, delay);

        completionSoundTimers.push(timerId);
      }
    }

    function sendCompletionNotification(mode) {
      playCompletionAlertSequence();
      vibrateAlert();

      if (!timerSettings.systemNotificationsEnabled) return;

      const nextMinutes =
        Number(timerSettings.nextWorkMinutes) || 25;

      const title =
        mode === "work"
          ? "集中タイマーが終わりました"
          : "休憩タイマーが終わりました";
      const body =
        mode === "work"
          ? "休憩時間を選んでください。"
          : timerSettings.autoStartNextWork
            ? `${nextMinutes}分の集中タイマーを自動で始めます。`
            : "次の作業を選んでください。";

      const count = timerSettings.repeatNotifications
        ? Math.max(1, Number(timerSettings.notificationCount) || 1)
        : 1;

      for (let index = 0; index < count; index += 1) {
        setTimeout(() => {
          showSystemNotification(
            title,
            body,
            `timer-${Date.now()}-${index}`
          );
        }, index * 1600);
      }
    }

    function testOpenAlert() {
      playAlertSound();
      const vibrated = vibrateAlert();

      setNotificationStatus(
        vibrated
          ? "音・バイブをテストしました。"
          : "音をテストしました。バイブ非対応の端末では振動しません。"
      );
    }

    async function testSystemNotification() {
      const allowed = await requestNotificationPermission();
      if (!allowed) return;

      setNotificationStatus("3秒後にテスト通知を送ります。");

      setTimeout(async () => {
        const shown = await showSystemNotification(
          "タイマー通知のテスト",
          "通知はこのように届きます。",
          `test-${Date.now()}`
        );

        setNotificationStatus(
          shown
            ? "テスト通知を送りました。"
            : "通知を送れませんでした。アプリを閉じて開き直してから再試行してください。"
        );
      }, 3000);
    }

    window.updateShuntaNotificationSettingsUI = updateNotificationSettingsUI;

    function initNotificationFeature() {
      bindEvent(openSoundToggle, "change", () => {
        timerSettings.soundEnabled = openSoundToggle.checked;
        saveTimerSettings();
      });
      bindEvent(openVibrationToggle, "change", () => {
        timerSettings.vibrationEnabled = openVibrationToggle.checked;
        saveTimerSettings();
      });
      bindEvent(systemNotificationToggle, "change", async () => {
        if (systemNotificationToggle.checked) {
          const allowed = await requestNotificationPermission();
          if (!allowed) systemNotificationToggle.checked = false;
        } else {
          timerSettings.systemNotificationsEnabled = false;
          saveTimerSettings();
          updateNotificationSettingsUI();
        }
      });
      bindEvent(notificationCountSelect, "change", () => {
        timerSettings.notificationCount = Number(notificationCountSelect.value) || 1;
        saveTimerSettings();
      });
      bindEvent(repeatNotificationToggle, "change", () => {
        timerSettings.repeatNotifications = repeatNotificationToggle.checked;
        saveTimerSettings();
      });
      bindEvent(alertSoundSelect, "change", () => {
        timerSettings.soundType = alertSoundSelect.value;
        saveTimerSettings();
        primeAlertAudio();
        playAlertSound();
      });
      bindEvent(testOpenAlertButton, "click", testOpenAlert);
      bindEvent(requestNotificationButton, "click", requestNotificationPermission);
      bindEvent(testSystemNotificationButton, "click", testSystemNotification);
      updateNotificationSettingsUI();
      registerNotificationServiceWorker();
    }
