"use strict";

    function showTab(tabName) {
      const selectedTab = normalizeStoredTab(tabName);
      activeTab = selectedTab;

      for (const button of tabButtons) {
        button.setAttribute(
          "aria-selected",
          String(button.dataset.tabTarget === selectedTab)
        );
      }

      for (const panel of tabPanels) {
        panel.hidden = panel.dataset.tabPanel !== selectedTab;
      }

      const titles = {
        timer: "タイマーをセットする",
        schedule: "1日の管理",
        records: "今日・記録"
      };
      screenTitle.textContent = titles[selectedTab];
      customToggleButton.hidden = selectedTab !== "timer";

      try {
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, selectedTab);
      } catch {
        // 保存できなくても画面切り替えは続ける。
      }
    }

    function showMode(modeName) {
      activeMode = modeName;

      for (const button of modeButtons) {
        button.setAttribute(
          "aria-selected",
          String(button.dataset.modeTarget === modeName)
        );
      }

      for (const panel of modePanels) {
        panel.hidden = panel.dataset.modePanel !== modeName;
      }

      customTimerPanel.hidden = true;
      timerMessage.hidden = true;
    }

    function resetTimerScreen(message = "") {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      activeTimer = null;
      pendingWorkEndReason = "manual";
      document.body.classList.remove("timer-focus");
      document.body.style.overflow = "";
      activeTimerPanel.classList.remove("paused");
      pauseTimerButton.textContent = "一時停止";
      timerSetup.hidden = false;
      activeTimerPanel.hidden = true;
      timerDecisionPanel.hidden = true;
      customTimerPanel.hidden = true;
      timerTime.textContent = "00:00";

      if (message) {
        timerMessage.textContent = message;
        timerMessage.hidden = false;
      } else {
        timerMessage.hidden = true;
      }
    }

    function updateActiveTimerModeUI() {
      if (!activeTimer) return;

      const isWork = activeTimer.mode === "work";

      timerOverlayTitle.textContent = isWork ? "集中する" : "休憩中";
      timerModeCaption.textContent = isWork ? "作業中" : "休憩中";
      workTimerVisual.hidden = !isWork;
      restTimerVisual.hidden = isWork;
      nextWorkPanel.hidden = isWork;
      updateNextWorkChoiceUI();
    }

    function startTimerForMode(mode, minutes, label) {
      const numericMinutes = Number(minutes);

      if (!Number.isFinite(numericMinutes) || numericMinutes < 1) {
        alert("1分以上の時間を入力してください。");
        return;
      }

      primeAlertAudio();
      showMode(mode);

      if (timerInterval) {
        clearInterval(timerInterval);
      }

      const startedAt = new Date();
      activeTimer = {
        mode,
        plannedMinutes: numericMinutes,
        initialPlannedMinutes: numericMinutes,
        label,
        startedAt: startedAt.toISOString(),
        endTime: startedAt.getTime() + numericMinutes * 60 * 1000,
        isPaused: false,
        pausedAt: null,
        expiredHandling: false,
        segments: [{
          startedAt: startedAt.toISOString(),
          finishedAt: null
        }]
      };

      document.body.classList.add("timer-focus");
      timerSetup.hidden = true;
      customTimerPanel.hidden = true;
      timerDecisionPanel.hidden = true;
      timerMessage.hidden = true;
      activeTimerPanel.hidden = false;

      activeTimerPanel.classList.remove("paused");
      pauseTimerButton.textContent = "一時停止";
      updateActiveTimerModeUI();
      updateTimerDisplay();

      timerInterval = setInterval(() => {
        updateTimerDisplay();

        if (
          activeTimer &&
          !activeTimer.isPaused &&
          Date.now() >= activeTimer.endTime
        ) {
          handleTimerExpired();
        }
      }, 500);
    }

    function startTimer(minutes, label) {
      startTimerForMode(activeMode, minutes, label);
    }

    function updateTimerDisplay() {
      if (!activeTimer) return;

      const remainingMs = Math.max(0, activeTimer.endTime - Date.now());
      const totalSeconds = Math.ceil(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;

      timerTime.textContent =
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0");
    }

    function closeCurrentTimerSegment(finishedAt = new Date()) {
      if (!activeTimer || !Array.isArray(activeTimer.segments)) return;

      const current = activeTimer.segments[activeTimer.segments.length - 1];
      if (current && !current.finishedAt) {
        current.finishedAt = finishedAt.toISOString();
      }
    }

    function calculateActiveMilliseconds() {
      if (!activeTimer || !Array.isArray(activeTimer.segments)) return 0;

      const now = Date.now();
      return activeTimer.segments.reduce((total, segment) => {
        const start = new Date(segment.startedAt).getTime();
        const end = segment.finishedAt
          ? new Date(segment.finishedAt).getTime()
          : now;

        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
          return total;
        }

        return total + (end - start);
      }, 0);
    }

    function calculateActualMinutes() {
      return Math.max(
        0,
        Math.round(calculateActiveMilliseconds() / 60000)
      );
    }

    function addActualTimelineSegments(segments, title, timerSessionId) {
      if (!Array.isArray(segments)) return false;

      let added = false;

      segments.forEach((segment, index) => {
        if (!segment.startedAt || !segment.finishedAt) return;

        const duration =
          new Date(segment.finishedAt).getTime() -
          new Date(segment.startedAt).getTime();

        if (duration < 60 * 1000) return;

        const segmentAdded = addActualTimelineEntry({
          startedAt: segment.startedAt,
          finishedAt: segment.finishedAt,
          title,
          timerSessionId: `${timerSessionId}-${index}`
        });

        added = added || segmentAdded;
      });

      return added;
    }

    function togglePauseTimer() {
      if (!activeTimer) return;

      if (!activeTimer.isPaused) {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }

        const pausedAt = new Date();
        closeCurrentTimerSegment(pausedAt);
        activeTimer.isPaused = true;
        activeTimer.pausedAt = pausedAt.toISOString();

        activeTimerPanel.classList.add("paused");
        timerOverlayTitle.textContent = "一時停止中";
        pauseTimerButton.textContent = "再開";
        return;
      }

      const resumedAt = new Date();
      const pausedAt = new Date(activeTimer.pausedAt).getTime();
      const pauseDuration = resumedAt.getTime() - pausedAt;

      if (Number.isFinite(pauseDuration) && pauseDuration > 0) {
        activeTimer.endTime += pauseDuration;
      }

      activeTimer.isPaused = false;
      activeTimer.pausedAt = null;
      activeTimer.segments.push({
        startedAt: resumedAt.toISOString(),
        finishedAt: null
      });

      activeTimerPanel.classList.remove("paused");
      updateActiveTimerModeUI();
      pauseTimerButton.textContent = "一時停止";

      timerInterval = setInterval(() => {
        updateTimerDisplay();

        if (
          activeTimer &&
          !activeTimer.isPaused &&
          Date.now() >= activeTimer.endTime
        ) {
          handleTimerExpired();
        }
      }, 500);
    }

    function prepareWorkFinish(endReason) {
      if (!activeTimer || activeTimer.mode !== "work") return;

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      closeCurrentTimerSegment();
      activeTimer.expiredHandling = true;
      pendingWorkEndReason = endReason;
      timerTime.textContent = "00:00";

      activeTimerPanel.hidden = true;
      timerDecisionPanel.hidden = false;

      workFinishedSummary.textContent =
        endReason === "scheduled"
          ? "予定時間で停止しました。休憩時間を選ぶと、すぐに休憩が始まります。"
          : "ここで作業を区切りました。休憩時間を選べます。";

    }

    function handleTimerExpired() {
      if (!activeTimer || activeTimer.expiredHandling) return;

      activeTimer.expiredHandling = true;

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      closeCurrentTimerSegment();
      timerTime.textContent = "00:00";
      sendCompletionNotification(activeTimer.mode);

      if (activeTimer.mode === "rest") {
        finishRestTimer(true);
        return;
      }

      prepareWorkFinish("scheduled");
    }

    function saveWorkSession(endReason) {
      if (!activeTimer || activeTimer.mode !== "work") return null;

      closeCurrentTimerSegment();
      const activeMilliseconds = calculateActiveMilliseconds();

      if (activeMilliseconds < 60 * 1000) {
        return { skipped: true };
      }

      const lastFinishedSegment = [...activeTimer.segments]
        .reverse()
        .find(segment => segment.finishedAt);

      const finishedAt =
        lastFinishedSegment?.finishedAt || new Date().toISOString();
      const actualMinutes = calculateActualMinutes();
      const plannedTotal = activeTimer.initialPlannedMinutes;

      let status = "途中で終了";
      let statusType = "early";

      if (endReason === "scheduled") {
        status = "予定どおり終了";
        statusType = "onTime";
      }

      const record = {
        id: Date.now(),
        label: activeTimer.label,
        initialPlannedMinutes: activeTimer.initialPlannedMinutes,
        plannedTotalMinutes: plannedTotal,
        actualMinutes,
        status,
        statusType,
        startedAt: activeTimer.startedAt,
        finishedAt,
        segments: activeTimer.segments.map(segment => ({ ...segment }))
      };

      const records = loadArray(WORK_STORAGE_KEY);
      records.push(record);
      saveArray(WORK_STORAGE_KEY, records);

      record.timelineAdded = addActualTimelineSegments(
        record.segments,
        "作業",
        `work-${record.id}`
      );

      return record;
    }

    function completeWorkAndStartBreak(minutes) {
      const breakMinutes = Number(minutes);
      const record = saveWorkSession(pendingWorkEndReason);

      renderWorkHistory();

      if (record && !record.skipped) {
        renderSchedule();
      }

      startTimerForMode(
        "rest",
        breakMinutes,
        restLabelForMinutes(breakMinutes)
      );
    }

    function finishWorkWithoutBreak() {
      const record = saveWorkSession(pendingWorkEndReason);
      let message = "作業を終了しました。";

      if (record?.skipped) {
        message = "1分未満のため記録しませんでした。";
      } else if (record) {
        message = `約${record.actualMinutes}分、作業しました。`;
      }

      resetTimerScreen(message);
      renderWorkHistory();
      renderSchedule();
    }

    function finishRestTimer(expired = false) {
      if (!activeTimer || activeTimer.mode !== "rest") return;

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      closeCurrentTimerSegment();

      const nextMinutes =
        Number(timerSettings.nextWorkMinutes) || 25;
      const shouldAutoStart =
        timerSettings.autoStartNextWork;

      if (shouldAutoStart) {
        startTimerForMode(
          "work",
          nextMinutes,
          workLabelForMinutes(nextMinutes)
        );
        return;
      }

      resetTimerScreen(
        expired
          ? "休憩が終わりました。"
          : "休憩を終了しました。"
      );
      showMode("work");
    }

    function finishTimerManually() {
      if (!activeTimer) return;

      if (activeTimer.mode === "rest") {
        finishRestTimer(false);
      } else {
        prepareWorkFinish("manual");
      }
    }

    function cancelTimer() {
      resetTimerScreen(
        "タイマーを取り消しました。記録は保存されていません。"
      );
    }

    function formatLocalTime(date) {
      return (
        String(date.getHours()).padStart(2, "0") +
        ":" +
        String(date.getMinutes()).padStart(2, "0")
      );
    }

    function addActualTimelineEntry({
      startedAt,
      finishedAt,
      title,
      timerSessionId
    }) {
      const startDate = new Date(startedAt);
      const finishDate = new Date(finishedAt);

      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(finishDate.getTime()) ||
        finishDate <= startDate
      ) {
        return false;
      }

      const records = loadArray(SCHEDULE_STORAGE_KEY);

      if (
        timerSessionId &&
        records.some(record => record.timerSessionId === timerSessionId)
      ) {
        return false;
      }

      let segmentStart = new Date(startDate);
      let segmentIndex = 0;
      let added = false;

      while (segmentStart < finishDate) {
        const nextMidnight = new Date(segmentStart);
        nextMidnight.setHours(24, 0, 0, 0);

        const segmentEnd =
          finishDate < nextMidnight ? finishDate : nextMidnight;

        let start = formatLocalTime(segmentStart);
        let end =
          segmentEnd.getTime() === nextMidnight.getTime()
            ? "23:59"
            : formatLocalTime(segmentEnd);

        // 1分未満でもタイムライン上で見えるよう、最低1分として表示する。
        if (timeToMinutes(end) <= timeToMinutes(start)) {
          const minimumEnd = Math.min(1439, timeToMinutes(start) + 1);
          end = minutesToTime(minimumEnd);
        }

        if (timeToMinutes(end) > timeToMinutes(start)) {
          records.push({
            id: Date.now() + segmentIndex,
            date: getDateKey(segmentStart),
            kind: "actual",
            title,
            start,
            end,
            source: "timer",
            timerSessionId
          });
          added = true;
        }

        segmentStart = new Date(segmentEnd);
        segmentIndex += 1;
      }

      if (added) {
        saveArray(SCHEDULE_STORAGE_KEY, records);
        renderSchedule();
      }

      return added;
    }

    function timeToMinutes(time) {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
    }

    function minutesToTime(totalMinutes) {
      const normalized = Math.max(0, Math.min(1439, totalMinutes));
      const hours = Math.floor(normalized / 60);
      const minutes = normalized % 60;
      return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0")
      );
    }

    function roundToFiveMinutes(totalMinutes) {
      return Math.min(1435, Math.max(0, Math.round(totalMinutes / 5) * 5));
    }

    function normalizeScheduleStart() {
      // 開始時刻は5分刻みの選択肢だけなので補正不要。
      return scheduleStart.value;
    }

    function populateScheduleStartOptions() {
      scheduleStart.replaceChildren();

      for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
        const option = document.createElement("option");
        option.value = minutesToTime(minutes);
        option.textContent = minutesToTime(minutes);
        scheduleStart.appendChild(option);
      }
    }

    function populateScheduleDurations() {
      scheduleDuration.replaceChildren();

      for (let minutes = 5; minutes <= 240; minutes += 5) {
        const option = document.createElement("option");
        option.value = String(minutes);
        option.textContent = `${minutes}分`;

        if (minutes === 30) {
          option.selected = true;
        }

        scheduleDuration.appendChild(option);
      }
    }

    function setInitialScheduleTimes() {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const roundedStart = Math.min(
        1435,
        Math.ceil(currentMinutes / 5) * 5
      );

      scheduleStart.value = minutesToTime(roundedStart);
    }

    function changeScheduleDate(dayDifference) {
      const date = new Date(scheduleDate.value + "T00:00:00");
      date.setDate(date.getDate() + dayDifference);
      scheduleDate.value = getDateKey(date);
      renderSchedule();
    }

    function addScheduleRecord() {
      const title = scheduleTitle.value.trim();
      normalizeScheduleStart();

      const start = scheduleStart.value;
      const durationMinutes = Number(scheduleDuration.value);

      if (
        !scheduleDate.value ||
        !title ||
        !start ||
        !Number.isFinite(durationMinutes)
      ) {
        alert("日付・内容・開始時刻・時間を入力してください。");
        return;
      }

      const startMinutes = timeToMinutes(start);
      const endMinutes = startMinutes + durationMinutes;

      if (endMinutes > 1439) {
        alert("日付をまたぐ計画は、翌日分を分けて登録してください。");
        return;
      }

      const end = minutesToTime(endMinutes);
      const records = loadArray(SCHEDULE_STORAGE_KEY);

      records.push({
        id: Date.now(),
        date: scheduleDate.value,
        kind: scheduleKind.value,
        title,
        start,
        end,
        durationMinutes
      });

      saveArray(SCHEDULE_STORAGE_KEY, records);

      scheduleTitle.value = "";
      scheduleStart.value = end;
      renderSchedule();
    }

    function deleteScheduleRecord(id) {
      const records = loadArray(SCHEDULE_STORAGE_KEY)
        .filter(record => String(record.id) !== String(id));
      saveArray(SCHEDULE_STORAGE_KEY, records);
      renderSchedule();
    }

    function populateEditStartOptions(kind, preferredValue) {
      editScheduleStart.replaceChildren();

      const step = kind === "plan" ? 5 : 1;

      for (let minutes = 0; minutes < 24 * 60; minutes += step) {
        const value = minutesToTime(minutes);
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        editScheduleStart.appendChild(option);
      }

      let value = preferredValue;

      if (!value) {
        value = scheduleStart.value || "00:00";
      }

      if (kind === "plan") {
        value = minutesToTime(
          roundToFiveMinutes(timeToMinutes(value))
        );
      }

      editScheduleStart.value = value;
    }

    function populateEditDurationOptions(
      kind,
      preferredDuration = null
    ) {
      editScheduleDuration.replaceChildren();

      const step = kind === "plan" ? 5 : 1;
      const defaultMaximum = kind === "plan" ? 240 : 720;
      const maximum = Math.max(
        defaultMaximum,
        Number(preferredDuration) || 0
      );

      for (let minutes = step; minutes <= maximum; minutes += step) {
        const option = document.createElement("option");
        option.value = String(minutes);
        option.textContent = `${minutes}分`;
        editScheduleDuration.appendChild(option);
      }

      let duration = Math.max(
        step,
        Number(preferredDuration) || (kind === "plan" ? 30 : 1)
      );

      if (kind === "plan") {
        duration = Math.max(5, Math.round(duration / 5) * 5);
      }

      if (
        ![...editScheduleDuration.options]
          .some(option => Number(option.value) === duration)
      ) {
        const option = document.createElement("option");
        option.value = String(duration);
        option.textContent = `${duration}分`;
        editScheduleDuration.appendChild(option);
      }

      editScheduleDuration.value = String(duration);
    }

    function openScheduleEditor(record) {
      editingScheduleId = record.id;

      const duration = Math.max(
        1,
        timeToMinutes(record.end) - timeToMinutes(record.start)
      );

      editScheduleKind.value = record.kind;
      editScheduleDate.value = record.date;
      editScheduleTitle.value = record.title;
      populateEditStartOptions(record.kind, record.start);
      populateEditDurationOptions(record.kind, duration);

      scheduleEditHeading.textContent =
        record.kind === "plan" ? "計画を編集" : "実際を編集";

      scheduleEditOverlay.hidden = false;
      document.body.classList.add("schedule-edit-open");
      editScheduleTitle.focus();
      editScheduleTitle.select();
    }

    function closeScheduleEditor() {
      editingScheduleId = null;
      scheduleEditOverlay.hidden = true;
      document.body.classList.remove("schedule-edit-open");
    }

    function saveScheduleEdit() {
      if (editingScheduleId === null) return;

      const title = editScheduleTitle.value.trim();
      const start = editScheduleStart.value;
      const durationMinutes = Number(editScheduleDuration.value);

      if (
        !editScheduleDate.value ||
        !title ||
        !start ||
        !Number.isFinite(durationMinutes) ||
        durationMinutes < 1
      ) {
        alert("日付・内容・開始・長さを入力してください。");
        return;
      }

      const startMinutes = timeToMinutes(start);
      const endMinutes = startMinutes + durationMinutes;

      if (endMinutes > 1439) {
        alert("日付をまたぐ記録は、翌日分を分けて登録してください。");
        return;
      }

      const records = loadArray(SCHEDULE_STORAGE_KEY);
      const record = records.find(
        item => String(item.id) === String(editingScheduleId)
      );

      if (!record) {
        alert("編集する記録が見つかりませんでした。");
        closeScheduleEditor();
        renderSchedule();
        return;
      }

      record.kind = editScheduleKind.value;
      record.date = editScheduleDate.value;
      record.title = title;
      record.start = start;
      record.end = minutesToTime(endMinutes);
      record.durationMinutes = durationMinutes;
      record.manuallyEdited = true;

      saveArray(SCHEDULE_STORAGE_KEY, records);

      scheduleDate.value = record.date;
      closeScheduleEditor();
      renderSchedule();
    }

    function deleteEditingSchedule() {
      if (editingScheduleId === null) return;

      deleteScheduleRecord(editingScheduleId);
      closeScheduleEditor();
    }

    function createScheduleEvent(record, laneIndex = 0, laneCount = 1) {
      const pxPerMinute = 48 / 60;
      const startMinutes = timeToMinutes(record.start);
      const endMinutes = timeToMinutes(record.end);

      const event = document.createElement("div");
      const durationMinutes = endMinutes - startMinutes;

      // 60分未満は高さが足りず2行表示が潰れるため、
      // 時刻と内容を横並びの1行で表示する。
      const isCompact = durationMinutes < 60 || laneCount > 1;

      event.className =
        "schedule-event" +
        (record.kind === "actual" ? " actual" : "") +
        (isCompact ? " compact" : "");

      event.style.top = `${startMinutes * pxPerMinute}px`;
      event.style.height =
        `${Math.max(26, durationMinutes * pxPerMinute)}px`;

      if (laneCount > 1) {
        const laneWidth = 100 / laneCount;
        event.style.left = `calc(${laneIndex * laneWidth}% + 4px)`;
        event.style.width = `calc(${laneWidth}% - 8px)`;
        event.style.right = "auto";
      }

      event.title =
        record.kind === "actual"
          ? `${durationMinutes}分`
          : `${record.start}–${record.end} ${record.title}`;

      const time = document.createElement("span");
      time.className = "schedule-event-time";
      time.textContent =
        record.kind === "actual"
          ? `${durationMinutes}分`
          : `${record.start}–${record.end}`;

      const title = document.createElement("span");
      title.className = "schedule-event-title";
      title.textContent = record.title;

      if (record.kind === "actual") {
        title.hidden = true;
      }

      event.tabIndex = 0;
      event.setAttribute("role", "button");
      event.setAttribute(
        "aria-label",
        record.kind === "actual"
          ? `${durationMinutes}分の記録を編集`
          : `${record.start}から${record.end}の${record.title}を編集`
      );

      event.addEventListener("click", () => {
        openScheduleEditor(record);
      });

      event.addEventListener("keydown", eventKey => {
        if (eventKey.key === "Enter" || eventKey.key === " ") {
          eventKey.preventDefault();
          openScheduleEditor(record);
        }
      });

      event.append(time, title);
      return event;
    }

    function layoutScheduleRecords(records) {
      const pxPerMinute = 48 / 60;
      const minimumVisualMinutes = 26 / pxPerMinute;

      const items = records
        .map(record => {
          const start = timeToMinutes(record.start);
          const end = timeToMinutes(record.end);

          return {
            record,
            start,
            visualEnd: Math.max(end, start + minimumVisualMinutes),
            laneIndex: 0,
            laneCount: 1
          };
        })
        .sort((a, b) => a.start - b.start);

      const laidOut = [];
      let group = [];
      let groupEnd = -1;

      function finishGroup() {
        if (group.length === 0) return;

        const laneEnds = [];

        for (const item of group) {
          let laneIndex = laneEnds.findIndex(end => end <= item.start);

          if (laneIndex === -1) {
            laneIndex = laneEnds.length;
          }

          laneEnds[laneIndex] = item.visualEnd;
          item.laneIndex = laneIndex;
        }

        const laneCount = Math.max(1, laneEnds.length);

        for (const item of group) {
          item.laneCount = laneCount;
          laidOut.push(item);
        }

        group = [];
        groupEnd = -1;
      }

      for (const item of items) {
        if (group.length === 0 || item.start < groupEnd) {
          group.push(item);
          groupEnd = Math.max(groupEnd, item.visualEnd);
        } else {
          finishGroup();
          group.push(item);
          groupEnd = item.visualEnd;
        }
      }

      finishGroup();
      return laidOut;
    }

    function renderTimeAxis() {
      timeAxis.replaceChildren();

      for (let hour = 0; hour <= 24; hour++) {
        const label = document.createElement("span");
        label.className = "hour-label";
        label.style.top = `${hour * 48}px`;
        label.textContent = String(hour).padStart(2, "0") + ":00";
        timeAxis.appendChild(label);
      }
    }

    function renderNowLine(container) {
      if (scheduleDate.value !== getDateKey()) return;

      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();

      const line = document.createElement("div");
      line.className = "now-line";
      line.style.top = `${minutes * (48 / 60)}px`;
      container.appendChild(line);
    }

    function renderSchedule() {
      renderTimeAxis();
      planTimeline.replaceChildren();
      actualTimeline.replaceChildren();

      const records = loadArray(SCHEDULE_STORAGE_KEY)
        .filter(record => record.date === scheduleDate.value)
        .sort((a, b) => a.start.localeCompare(b.start));

      const plans = records.filter(record => record.kind === "plan");
      const actuals = records.filter(record => record.kind === "actual");

      for (const item of layoutScheduleRecords(plans)) {
        planTimeline.appendChild(
          createScheduleEvent(item.record, item.laneIndex, item.laneCount)
        );
      }

      for (const item of layoutScheduleRecords(actuals)) {
        actualTimeline.appendChild(
          createScheduleEvent(item.record, item.laneIndex, item.laneCount)
        );
      }

      renderNowLine(planTimeline);
      renderNowLine(actualTimeline);
    }

    function setTodayTask() {
      const text = taskInput.value.trim();
      if (!text) return;

      const records = loadArray(TASK_STORAGE_KEY);
      const today = getDateKey();
      const existing = records.find(record => record.date === today);

      if (existing) {
        existing.text = text;
        existing.done = false;
        existing.completedAt = null;
      } else {
        records.push({
          date: today,
          text,
          done: false,
          completedAt: null
        });
      }

      saveArray(TASK_STORAGE_KEY, records);
      taskInput.value = "";
      renderTaskRecords();
    }

    function completeTodayTask() {
      const records = loadArray(TASK_STORAGE_KEY);
      const today = getDateKey();
      const record = records.find(item => item.date === today);
      if (!record) return;

      record.done = true;
      record.completedAt = new Date().toISOString();
      saveArray(TASK_STORAGE_KEY, records);
      renderTaskRecords();
    }

    function renderToday(records) {
      const today = getDateKey();
      const record = records.find(item => item.date === today);
      todayArea.replaceChildren();

      if (!record) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "まだ今日の一歩は決まっていません。";
        todayArea.appendChild(empty);
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "today-task" + (record.done ? " done" : "");

      const text = document.createElement("span");
      text.textContent = record.done ? `✓ ${record.text}` : record.text;

      const button = document.createElement("button");
      button.className = record.done ? "secondary" : "primary";
      button.type = "button";
      button.textContent = record.done ? "完了済み" : "できた";
      button.disabled = record.done;

      if (!record.done) {
        button.addEventListener("click", completeTodayTask);
      }

      wrapper.append(text, button);
      todayArea.appendChild(wrapper);
    }

    function renderWeek(records) {
      weekArea.replaceChildren();

      for (let offset = 6; offset >= 0; offset--) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);

        const dateKey = getDateKey(date);
        const record = records.find(item => item.date === dateKey);

        const day = document.createElement("div");
        day.className = "day" + (record?.done ? " done" : "");

        const weekday = new Intl.DateTimeFormat("ja-JP", {
          weekday: "short"
        }).format(date);

        day.innerHTML = `
          <div>${weekday}</div>
          <div>${date.getDate()}</div>
          <div>${record?.done ? "✓" : "・"}</div>
        `;
        weekArea.appendChild(day);
      }
    }

    function renderHistory(records) {
      historyList.replaceChildren();

      const completed = records
        .filter(record => record.done)
        .sort((a, b) => b.date.localeCompare(a.date));

      if (completed.length === 0) {
        const item = document.createElement("li");
        item.className = "empty";
        item.textContent = "まだ完了した記録はありません。";
        historyList.appendChild(item);
        return;
      }

      for (const record of completed) {
        const item = document.createElement("li");

        const text = document.createElement("span");
        text.textContent = record.text;

        const date = document.createElement("span");
        date.className = "history-date";
        date.textContent = formatDate(record.date);

        item.append(text, date);
        historyList.appendChild(item);
      }
    }

    function renderWorkHistory() {
      workHistoryList.replaceChildren();

      const records = loadArray(WORK_STORAGE_KEY)
        .filter(record => record && record.startedAt)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 20);

      if (records.length === 0) {
        const item = document.createElement("li");
        item.className = "empty";
        item.textContent = "まだ作業の記録はありません。";
        workHistoryList.appendChild(item);
        return;
      }

      for (const record of records) {
        const item = document.createElement("li");

        const duration = document.createElement("span");
        duration.className = "recovery-detail";
        duration.textContent =
          `${Math.max(0, Number(record.actualMinutes) || 0)}分`;

        item.appendChild(duration);
        workHistoryList.appendChild(item);
      }
    }

    function renderTaskRecords() {
      const records = loadArray(TASK_STORAGE_KEY);
      renderToday(records);
      renderWeek(records);
      renderHistory(records);
    }

    function initNavigationFeature() {
      for (const button of tabButtons) bindEvent(button, "click", () => showTab(button.dataset.tabTarget));
      for (const button of modeButtons) bindEvent(button, "click", () => showMode(button.dataset.modeTarget));
    }

    function initTimerFeature() {
      for (const button of presetButtons) {
        bindEvent(button, "click", () => startTimer(Number(button.dataset.minutes), button.dataset.label || `${button.dataset.minutes}分`));
      }
      bindEvent(customToggleButton, "click", () => {
        customTimerPanel.hidden = !customTimerPanel.hidden;
        if (!customTimerPanel.hidden) customMinutes.focus();
      });
      bindEvent(startCustomTimerButton, "click", () => {
        const minutes = Number(customMinutes.value);
        startTimer(minutes, `${minutes}分`);
      });
      bindEvent(customMinutes, "keydown", event => {
        if (event.key === "Enter") startCustomTimerButton.click();
      });
      bindEvent(finishTimerButton, "click", finishTimerManually);
      bindEvent(pauseTimerButton, "click", togglePauseTimer);
      bindEvent(timerOverlayCloseButton, "click", cancelTimer);
      bindEvent(finishWithoutBreakButton, "click", finishWorkWithoutBreak);
      for (const button of breakChoiceButtons) {
        bindEvent(button, "click", () => completeWorkAndStartBreak(Number(button.dataset.breakMinutes)));
      }
      for (const button of nextWorkChoiceButtons) {
        bindEvent(button, "click", () => selectNextWorkMinutes(Number(button.dataset.nextWorkMinutes)));
      }
      bindEvent(document, "visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (activeTimer && !activeTimer.isPaused && Date.now() >= activeTimer.endTime) handleTimerExpired();
        if (typeof resumeCloudSession === "function") resumeCloudSession();
      });
      bindEvent(window, "focus", () => {
        if (activeTimer && !activeTimer.isPaused && Date.now() >= activeTimer.endTime) handleTimerExpired();
      });
    }

    function initScheduleFeature() {
      bindEvent(closeScheduleEditButton, "click", closeScheduleEditor);
      bindEvent(cancelScheduleEditButton, "click", closeScheduleEditor);
      bindEvent(saveScheduleEditButton, "click", saveScheduleEdit);
      bindEvent(deleteScheduleEditButton, "click", deleteEditingSchedule);
      bindEvent(scheduleEditOverlay, "click", event => {
        if (event.target === scheduleEditOverlay) closeScheduleEditor();
      });
      bindEvent(document, "keydown", event => {
        if (event.key === "Escape" && scheduleEditOverlay && !scheduleEditOverlay.hidden) closeScheduleEditor();
      });
      bindEvent(editScheduleKind, "change", () => {
        const currentStart = editScheduleStart.value;
        const currentDuration = Number(editScheduleDuration.value);
        populateEditStartOptions(editScheduleKind.value, currentStart);
        populateEditDurationOptions(editScheduleKind.value, currentDuration);
        scheduleEditHeading.textContent = editScheduleKind.value === "plan" ? "計画を編集" : "実際を編集";
      });
      bindEvent(addScheduleButton, "click", addScheduleRecord);
      bindEvent(scheduleTitle, "keydown", event => { if (event.key === "Enter") addScheduleRecord(); });
      bindEvent(scheduleDate, "change", renderSchedule);
      bindEvent(scheduleStart, "change", normalizeScheduleStart);
      bindEvent(previousDayButton, "click", () => changeScheduleDate(-1));
      bindEvent(todayScheduleButton, "click", () => { scheduleDate.value = getDateKey(); renderSchedule(); });
      bindEvent(nextDayButton, "click", () => changeScheduleDate(1));
    }

    function initTaskFeature() {
      bindEvent(saveTaskButton, "click", setTodayTask);
      bindEvent(taskInput, "keydown", event => { if (event.key === "Enter") setTodayTask(); });
    }

    function bootstrapShuntaApp() {
      scheduleDate.value = getDateKey();
      populateScheduleStartOptions();
      populateScheduleDurations();
      setInitialScheduleTimes();
      let storedTab = "timer";
      try { storedTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || "timer"; } catch { storedTab = "timer"; }
      startFeature("画面切り替え", initNavigationFeature);
      startFeature("タイマー", initTimerFeature);
      startFeature("1日の管理", initScheduleFeature);
      startFeature("記録", initTaskFeature);
      startFeature("通知", initNotificationFeature);
      startFeature("同期", initSyncFeature);
      showMode("work");
      showTab(storedTab);
      renderSchedule();
      renderTaskRecords();
      renderWorkHistory();
    }

    bootstrapShuntaApp();
