"use strict";

    function installZoomGuards() {
      const preventGesture = event => {
        event.preventDefault();
      };

      document.addEventListener(
        "gesturestart",
        preventGesture,
        { passive: false }
      );
      document.addEventListener(
        "gesturechange",
        preventGesture,
        { passive: false }
      );
      document.addEventListener(
        "gestureend",
        preventGesture,
        { passive: false }
      );

      document.addEventListener(
        "touchmove",
        event => {
          if (event.touches && event.touches.length > 1) {
            event.preventDefault();
          }
        },
        { passive: false }
      );

      document.addEventListener(
        "dblclick",
        event => {
          event.preventDefault();
        },
        { passive: false }
      );

      let lastTouchEnd = 0;

      document.addEventListener(
        "touchend",
        event => {
          const now = Date.now();

          if (now - lastTouchEnd <= 300) {
            event.preventDefault();
          }

          lastTouchEnd = now;
        },
        { passive: false }
      );
    }

    installZoomGuards();

    const TASK_STORAGE_KEY = "tsumikasane-records-v1";
    const RECOVERY_STORAGE_KEY = "tsumikasane-recovery-v1";
    const WORK_STORAGE_KEY = "tsumikasane-work-v1";
    const SCHEDULE_STORAGE_KEY = "tsumikasane-schedule-v1";
    const ACTIVE_TAB_STORAGE_KEY = "tsumikasane-active-tab-v2";
    const LOCAL_UPDATED_AT_KEY = "tsumikasane-local-updated-at-v1";
    const TIMER_SETTINGS_STORAGE_KEY = "shunta-timer-settings-v2";

    const SUPABASE_URL = "https://rpqtdcroxxffjygunaui.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_xPFkIrC2ouvoi5g5JMvQWw_gCXJOU9n";
    const SUPABASE_AUTH_STORAGE_KEY =
      "shunta-supabase-session-v1";

    function loadTimerSettings() {
      const defaults = {
        soundEnabled: true,
        vibrationEnabled: true,
        systemNotificationsEnabled: false,
        notificationCount: 1,
        repeatNotifications: false,
        soundType: "soft",
        nextWorkMinutes: 25,
        autoStartNextWork: true
      };

      try {
        const stored = JSON.parse(
          localStorage.getItem(TIMER_SETTINGS_STORAGE_KEY)
        );

        return {
          ...defaults,
          ...(stored && typeof stored === "object" ? stored : {})
        };
      } catch {
        return defaults;
      }
    }

    function saveTimerSettings() {
      try {
        localStorage.setItem(
          TIMER_SETTINGS_STORAGE_KEY,
          JSON.stringify(timerSettings)
        );
      } catch {
        // 端末設定なので、保存できなくてもタイマーは続ける。
      }
    }

    function workLabelForMinutes(minutes) {
      const labels = {
        10: "まずは始める",
        25: "短く集中",
        60: "しっかり取り組む"
      };

      return labels[minutes] || `${minutes}分`;
    }

    function restLabelForMinutes(minutes) {
      const labels = {
        1: "一休み",
        3: "短く休む",
        5: "少し休む",
        10: "短く休む",
        20: "少し長めに休む"
      };

      return labels[minutes] || `${minutes}分休憩`;
    }

    const CLOUD_STORAGE_KEYS = [
      TASK_STORAGE_KEY,
      RECOVERY_STORAGE_KEY,
      WORK_STORAGE_KEY,
      SCHEDULE_STORAGE_KEY
    ];

    const screenTitle = document.getElementById("screenTitle");
    const syncStatusButton =
      document.getElementById("syncStatusButton");
    const syncOverlay =
      document.getElementById("syncOverlay");
    const closeSyncButton =
      document.getElementById("closeSyncButton");
    const syncStateText =
      document.getElementById("syncStateText");
    const signedOutSyncPanel =
      document.getElementById("signedOutSyncPanel");
    const signedInSyncPanel =
      document.getElementById("signedInSyncPanel");
    const syncEmail =
      document.getElementById("syncEmail");
    const syncPassword =
      document.getElementById("syncPassword");
    const signInSyncButton =
      document.getElementById("signInSyncButton");
    const syncAccount =
      document.getElementById("syncAccount");
    const refreshFromCloudButton =
      document.getElementById("refreshFromCloudButton");
    const saveToCloudButton =
      document.getElementById("saveToCloudButton");
    const signOutSyncButton =
      document.getElementById("signOutSyncButton");

    const customToggleButton = document.getElementById("customToggleButton");
    const customTimerPanel = document.getElementById("customTimerPanel");
    const customMinutes = document.getElementById("customMinutes");
    const startCustomTimerButton = document.getElementById("startCustomTimerButton");

    const tabButtons = [...document.querySelectorAll("[data-tab-target]")];
    const tabPanels = [...document.querySelectorAll("[data-tab-panel]")];
    const modeButtons = [...document.querySelectorAll("[data-mode-target]")];
    const modePanels = [...document.querySelectorAll("[data-mode-panel]")];
    const presetButtons = [...document.querySelectorAll(".timer-preset")];

    const timerSetup = document.getElementById("timerSetup");
    const activeTimerPanel = document.getElementById("activeTimerPanel");
    const timerOverlayTitle = document.getElementById("timerOverlayTitle");
    const timerModeCaption = document.getElementById("timerModeCaption");
    const timerOverlayCloseButton =
      document.getElementById("timerOverlayCloseButton");
    const timerTime = document.getElementById("timerTime");
    const finishTimerButton = document.getElementById("finishTimerButton");
    const pauseTimerButton = document.getElementById("pauseTimerButton");
    const workTimerVisual = document.getElementById("workTimerVisual");
    const restTimerVisual = document.getElementById("restTimerVisual");
    const nextWorkPanel = document.getElementById("nextWorkPanel");
    const nextWorkChoiceButtons =
      [...document.querySelectorAll(".next-work-choice")];
    const openTimerSettingsButton =
      document.getElementById("openTimerSettingsButton");
    const openNotificationSettingsFromSetupButton =
      document.getElementById(
        "openNotificationSettingsFromSetupButton"
      );

    const timerDecisionPanel = document.getElementById("timerDecisionPanel");
    const workFinishedSummary =
      document.getElementById("workFinishedSummary");
    const finishWithoutBreakButton =
      document.getElementById("finishWithoutBreakButton");
    const breakChoiceButtons =
      [...document.querySelectorAll("[data-break-minutes]")];

    const notificationSettingsOverlay =
      document.getElementById("notificationSettingsOverlay");
    const closeNotificationSettingsButton =
      document.getElementById("closeNotificationSettingsButton");
    const openSoundToggle =
      document.getElementById("openSoundToggle");
    const openVibrationToggle =
      document.getElementById("openVibrationToggle");
    const systemNotificationToggle =
      document.getElementById("systemNotificationToggle");
    const notificationCountSelect =
      document.getElementById("notificationCountSelect");
    const repeatNotificationToggle =
      document.getElementById("repeatNotificationToggle");
    const alertSoundSelect =
      document.getElementById("alertSoundSelect");
    const testOpenAlertButton =
      document.getElementById("testOpenAlertButton");
    const requestNotificationButton =
      document.getElementById("requestNotificationButton");
    const testSystemNotificationButton =
      document.getElementById("testSystemNotificationButton");
    const notificationSettingsStatus =
      document.getElementById("notificationSettingsStatus");

    const timerMessage = document.getElementById("timerMessage");

    const scheduleDate = document.getElementById("scheduleDate");
    const previousDayButton = document.getElementById("previousDayButton");
    const todayScheduleButton = document.getElementById("todayScheduleButton");
    const nextDayButton = document.getElementById("nextDayButton");
    const scheduleKind = document.getElementById("scheduleKind");
    const scheduleTitle = document.getElementById("scheduleTitle");
    const scheduleStart = document.getElementById("scheduleStart");
    const scheduleDuration = document.getElementById("scheduleDuration");
    const addScheduleButton = document.getElementById("addScheduleButton");
    const timeAxis = document.getElementById("timeAxis");
    const planTimeline = document.getElementById("planTimeline");
    const actualTimeline = document.getElementById("actualTimeline");

    const scheduleEditOverlay =
      document.getElementById("scheduleEditOverlay");
    const scheduleEditHeading =
      document.getElementById("scheduleEditHeading");
    const closeScheduleEditButton =
      document.getElementById("closeScheduleEditButton");
    const editScheduleKind =
      document.getElementById("editScheduleKind");
    const editScheduleDate =
      document.getElementById("editScheduleDate");
    const editScheduleTitle =
      document.getElementById("editScheduleTitle");
    const editScheduleStart =
      document.getElementById("editScheduleStart");
    const editScheduleDuration =
      document.getElementById("editScheduleDuration");
    const saveScheduleEditButton =
      document.getElementById("saveScheduleEditButton");
    const deleteScheduleEditButton =
      document.getElementById("deleteScheduleEditButton");
    const cancelScheduleEditButton =
      document.getElementById("cancelScheduleEditButton");

    const taskInput = document.getElementById("taskInput");
    const saveTaskButton = document.getElementById("saveTaskButton");
    const todayArea = document.getElementById("todayArea");
    const weekArea = document.getElementById("weekArea");
    const historyList = document.getElementById("historyList");
    const workHistoryList = document.getElementById("workHistoryList");

    let activeTab = "timer";
    let activeMode = "work";
    let timerInterval = null;
    let activeTimer = null;
    let pendingWorkEndReason = "manual";
    let audioContext = null;
    let timerSettings = loadTimerSettings();

    if (![10, 25, 60].includes(Number(timerSettings.nextWorkMinutes))) {
      timerSettings.nextWorkMinutes = 25;
    }

    if (typeof timerSettings.autoStartNextWork !== "boolean") {
      timerSettings.autoStartNextWork = true;
    }

    saveTimerSettings();
    let editingScheduleId = null;

    function getDateKey(date = new Date()) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    }

    function loadArray(key) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function saveArray(key, records) {
      try {
        localStorage.setItem(key, JSON.stringify(records));
        localStorage.setItem(
          LOCAL_UPDATED_AT_KEY,
          new Date().toISOString()
        );
        scheduleCloudSync();
      } catch {
        alert("ブラウザに記録を保存できませんでした。");
      }
    }

    function formatDate(dateKey) {
      const date = new Date(dateKey + "T00:00:00");
      return new Intl.DateTimeFormat("ja-JP", {
        month: "numeric",
        day: "numeric",
        weekday: "short"
      }).format(date);
    }

    function formatDateTime(isoString) {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
    }

    function normalizeStoredTab(value) {
      if (value === "today") return "records";
      if (value === "recovery") return "timer";
      if (["timer", "schedule", "records"].includes(value)) return value;
      return "timer";
    }

    function bindEvent(element, eventName, handler, options) {
      if (!element) {
        console.warn(`[Shunta App] ${eventName}の対象が見つかりません。`);
        return false;
      }
      element.addEventListener(eventName, event => {
        try {
          const result = handler(event);
          if (result && typeof result.catch === "function") {
            result.catch(reportAppError);
          }
        } catch (error) {
          reportAppError(error);
        }
      }, options);
      return true;
    }

    function showAppError(message) {
      const banner = document.getElementById("appErrorBanner");
      if (!banner) return;
      banner.textContent = `一部の機能でエラーが起きました：${message}`;
      banner.hidden = false;
    }

    function reportAppError(error) {
      console.error(error);
      showAppError(error?.message || String(error) || "原因不明のエラー");
    }

    function startFeature(name, initializer) {
      try {
        const result = initializer();
        if (result && typeof result.catch === "function") {
          result.catch(error => {
            console.error(`[${name}]`, error);
            reportAppError(error);
          });
        }
      } catch (error) {
        console.error(`[${name}]`, error);
        reportAppError(error);
      }
    }

    window.addEventListener("error", event => {
      reportAppError(event.error || event.message);
    });
    window.addEventListener("unhandledrejection", event => {
      reportAppError(event.reason);
    });
