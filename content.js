// content.js - Main monitoring script injected into all pages
(() => {
  const STUDENT_ID_KEY = 'exam_student_id';
  const WARNING_DISPLAY_DURATION = 5000;
  const FACE_CHECK_INTERVAL = 2000;
  const AUDIO_CHECK_INTERVAL = 1000;
  const EYE_CHECK_INTERVAL = 3000;
  const SCREEN_SHARE_CHECK_INTERVAL = 3000;
  const MONITOR_CHECK_INTERVAL = 5000;

  let studentId = null;
  let monitoringActive = false;
  let cameraStream = null;
  let audioContext = null;
  let faceDetectionInterval = null;
  let audioDetectionInterval = null;
  let eyeTrackingInterval = null;
  let screenShareCheckInterval = null;
  let monitorCheckInterval = null;
  let lastWarningTime = 0;
  let initialScreenCount = null;

  // === UI Components ===
  
  function showWarningOverlay(msg, severity = 'warning') {
    const now = Date.now();
    if (now - lastWarningTime < 1000) return;
    lastWarningTime = now;

    let el = document.getElementById('exam-lockdown-warning');
    if (!el) {
      el = document.createElement('div');
      el.id = 'exam-lockdown-warning';
      document.documentElement.appendChild(el);
    }
    
    const colors = {
      warning: 'rgba(255, 200, 0, 0.95)',
      error: 'rgba(255, 60, 60, 0.95)',
      info: 'rgba(60, 150, 255, 0.95)'
    };
    
    Object.assign(el.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      zIndex: '2147483647',
      background: colors[severity] || colors.warning,
      color: '#000',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      fontWeight: 'bold',
      maxWidth: '300px',
      animation: 'slideIn 0.3s ease-out'
    });
    
    el.textContent = '⚠️ ' + msg;
    el.style.display = 'block';
    
    setTimeout(() => {
      el.style.display = 'none';
    }, WARNING_DISPLAY_DURATION);
  }

  function enforceBlock(info) {
    stopAllMonitoring();
    
    document.documentElement.innerHTML = '';
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: linear-gradient(135deg, #1a1a1a 0%, #2d0a0a 100%);
      color: #fff;
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
    `;
    
    container.innerHTML = `
      <div style="text-align: center; max-width: 600px;">
        <div style="font-size: 80px; margin-bottom: 20px;">🚫</div>
        <h1 style="font-size: 42px; margin-bottom: 12px; color: #ff4444;">ACCESS BLOCKED</h1>
        <p style="font-size: 20px; margin-bottom: 24px; color: #ffaaaa;">
          Your student ID has been permanently blocked due to multiple exam violations.
        </p>
        <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; text-align: left;">
          <p style="margin: 8px 0;"><strong>Student ID:</strong> ${studentId}</p>
          <p style="margin: 8px 0;"><strong>Block Time:</strong> ${info?.blockedAt || 'Unknown'}</p>
          <p style="margin: 8px 0;"><strong>Reason:</strong> ${info?.reason || 'Multiple infractions'}</p>
          <p style="margin: 8px 0;"><strong>Total Infractions:</strong> ${info?.totalInfractions || 'N/A'}</p>
        </div>
        <p style="margin-top: 24px; font-size: 16px; color: #aaa;">
          Please contact your exam administrator to resolve this issue.
        </p>
      </div>
    `;
    
    document.documentElement.appendChild(container);
    window.stop();
  }

  // === Student ID Management ===
  
  function getStudentId() {
    try {
      return localStorage.getItem(STUDENT_ID_KEY);
    } catch (e) {
      try {
        console.warn('LocalStorage access error:', e);
      } catch (err) {
        // Console not available
      }
      return null;
    }
  }

  function requireStudentId() {
    let id = getStudentId();
    if (!id) {
      id = prompt('🎓 Enter Your Student ID for Exam Monitoring:\n\n(Required to proceed with exam)');
      if (id && id.trim()) {
        id = id.trim();
        try { 
          localStorage.setItem(STUDENT_ID_KEY, id); 
        } catch(e) {
          try {
            console.warn('Failed to save student ID:', e);
          } catch (err) {
            // Console not available
          }
        }
      } else {
        alert('Student ID is required to take the exam. The page will reload.');
        location.reload();
        return null;
      }
    }
    return id;
  }

  // === Infraction Recording ===
  
  function recordInfraction(type, details = '') {
    if (!studentId) return;
    
    chrome.runtime.sendMessage({
      type: 'recordInfraction',
      studentId: studentId,
      infractionType: type,
      details: details,
      page: location.href
    }, response => {
      if (response && response.blocked) {
        enforceBlock({ 
          reason: response.blockReason,
          blockedAt: new Date().toISOString() 
        });
      } else if (response && response.ok) {
        showWarningOverlay(
          `${response.message}\nWarning ${response.warnings}/2`,
          'warning'
        );
      }
    });
  }

  // === NEW: Screen Sharing Detection ===
  
  function detectScreenSharingProcesses() {
    // Check for common screen sharing software indicators in the page title, URL, and DOM
    const indicators = [
      'anydesk',
      'teamviewer',
      'quickassist',
      'quick assist',
      'remote desktop',
      'chrome remote',
      'zoom share',
      'webex',
      'gotomeeting',
      'join.me',
      'screenconnect',
      'logmein',
      'splashtop',
      'vnc viewer',
      'remotepc'
    ];

    const pageTitle = document.title.toLowerCase();
    const pageUrl = window.location.href.toLowerCase();
    const bodyText = document.body.textContent.toLowerCase().substring(0, 5000);

    for (const indicator of indicators) {
      if (pageTitle.includes(indicator) || 
          pageUrl.includes(indicator) || 
          bodyText.includes(indicator)) {
        return indicator;
      }
    }

    // Check for remote desktop connection in window properties
    if (window.chrome && window.chrome.app) {
      // Chrome Remote Desktop detection
      return 'chrome remote desktop';
    }

    return null;
  }

  function startScreenShareMonitoring() {
    screenShareCheckInterval = setInterval(() => {
      const detected = detectScreenSharingProcesses();
      if (detected) {
        recordInfraction('SCREEN_SHARE', `Detected: ${detected}`);
        showWarningOverlay(
          `Screen sharing software detected: ${detected}. This is not allowed during exams!`,
          'error'
        );
      }

      // Check if getDisplayMedia is being used (screen sharing API)
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
        navigator.mediaDevices.getDisplayMedia = function(...args) {
          recordInfraction('SCREEN_SHARE', 'Screen capture API called');
          showWarningOverlay('Screen sharing attempt detected!', 'error');
          throw new Error('Screen sharing is not allowed during exams');
        };
      }
    }, SCREEN_SHARE_CHECK_INTERVAL);
  }

  // === NEW: Multiple Monitor Detection ===
  
  async function detectMultipleMonitors() {
    try {
      // Method 1: Check screen properties
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;
      const availWidth = window.screen.availWidth;
      const availHeight = window.screen.availHeight;
      
      // Method 2: Check for extended desktop (window can be moved beyond primary screen)
      const outerWidth = window.outerWidth;
      const outerHeight = window.outerHeight;
      
      // Method 3: Use Screen Orientation API to detect multiple displays
      if (window.screen.orientation) {
        // Some multi-monitor setups have different orientations
      }

      // Method 4: Check if window.screen reports unusual dimensions
      // Multiple monitors often show as one large virtual screen
      const aspectRatio = screenWidth / screenHeight;
      const isUltraWide = aspectRatio > 2.5; // Ultra-wide or multiple monitors
      
      if (isUltraWide) {
        return {
          detected: true,
          reason: 'Ultra-wide display detected (possible multiple monitors)',
          screenWidth,
          screenHeight,
          aspectRatio: aspectRatio.toFixed(2)
        };
      }

      // Method 5: Try to detect if window can be positioned outside primary screen
      const currentX = window.screenX || window.screenLeft;
      const currentY = window.screenY || window.screenTop;
      
      if (currentX < -100 || currentY < -100 || 
          currentX > screenWidth + 100 || currentY > screenHeight + 100) {
        return {
          detected: true,
          reason: 'Window positioned outside primary screen bounds',
          position: { x: currentX, y: currentY }
        };
      }

      // Method 6: Check for Screen Details API (Chrome 95+)
      if (window.screen && window.screen.isExtended !== undefined) {
        if (window.screen.isExtended) {
          return {
            detected: true,
            reason: 'Extended display mode detected via Screen Details API'
          };
        }
      }

      // Method 7: Request screen details permission and check
      if ('getScreenDetails' in window) {
        try {
          const screenDetails = await window.getScreenDetails();
          if (screenDetails.screens && screenDetails.screens.length > 1) {
            return {
              detected: true,
              reason: `Multiple displays detected: ${screenDetails.screens.length} screens`,
              screenCount: screenDetails.screens.length
            };
          }
        } catch (e) {
          // Permission denied or API not available - this is ok
        }
      }

      return { detected: false };
    } catch (error) {
      // Silent fail - don't record infraction for detection errors
      try {
        console.warn('Monitor detection error:', error);
      } catch (e) {
        // Console not available
      }
      return { detected: false };
    }
  }

  async function startMonitorDetection() {
    // Initial check
    const initialCheck = await detectMultipleMonitors();
    if (initialCheck.detected) {
      initialScreenCount = initialCheck.screenCount || 2;
      recordInfraction('MULTIPLE_MONITORS', initialCheck.reason);
      showWarningOverlay(
        'Multiple monitors detected! Please disconnect additional displays.',
        'error'
      );
    } else {
      initialScreenCount = 1;
    }

    // Periodic monitoring
    monitorCheckInterval = setInterval(async () => {
      const result = await detectMultipleMonitors();
      if (result.detected) {
        recordInfraction('MULTIPLE_MONITORS', result.reason);
        showWarningOverlay(
          'Multiple monitors still detected!',
          'error'
        );
      }
    }, MONITOR_CHECK_INTERVAL);

    // Monitor for screen changes
    window.addEventListener('resize', async () => {
      const result = await detectMultipleMonitors();
      if (result.detected) {
        recordInfraction('MULTIPLE_MONITORS', 'Screen configuration changed: ' + result.reason);
      }
    });

    // Monitor for window movement
    let lastScreenX = window.screenX;
    let lastScreenY = window.screenY;
    
    setInterval(() => {
      const currentX = window.screenX;
      const currentY = window.screenY;
      
      if (Math.abs(currentX - lastScreenX) > 100 || Math.abs(currentY - lastScreenY) > 100) {
        // Window moved significantly - might be moved to another monitor
        detectMultipleMonitors().then(result => {
          if (result.detected) {
            recordInfraction('MULTIPLE_MONITORS', 'Window moved to different display');
          }
        });
      }
      
      lastScreenX = currentX;
      lastScreenY = currentY;
    }, 2000);
  }

  // === Clipboard Protection ===
  
  function setupClipboardProtection() {
    const blockEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      recordInfraction('COPY_PASTE', `Action: ${e.type}`);
      return false;
    };

    document.addEventListener('copy', blockEvent, true);
    document.addEventListener('paste', blockEvent, true);
    document.addEventListener('cut', blockEvent, true);
    
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      recordInfraction('COPY_PASTE', 'Context menu attempt');
      return false;
    }, true);

    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const forbidden = ['c', 'v', 'x', 'a', 's', 'p'];
      
      if (ctrl && forbidden.includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        recordInfraction('COPY_PASTE', `Keyboard shortcut: Ctrl+${e.key}`);
        return false;
      }
      
      if (e.key === 'F12' || 
          (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))) {
        e.preventDefault();
        recordInfraction('COPY_PASTE', 'Dev tools attempt');
        return false;
      }
    }, true);

    document.execCommand = function() {
      recordInfraction('COPY_PASTE', 'execCommand blocked');
      return false;
    };
  }

  // === Tab Switch Detection ===
  
  function setupVisibilityDetection() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        recordInfraction('TAB_SWITCH', 'Page hidden - possible tab switch');
      }
    });

    window.addEventListener('blur', () => {
      recordInfraction('WINDOW_BLUR', 'Window lost focus');
    }, true);

    window.addEventListener('focus', () => {
      checkBlockedStatus();
    });
  }

  // === Navigation Protection ===
  
  function setupNavigationProtection() {
    window.addEventListener('beforeunload', (e) => {
      recordInfraction('NAVIGATION', 'Attempted to leave page');
      e.preventDefault();
      e.returnValue = 'Are you sure you want to leave the exam? This will be recorded.';
      return e.returnValue;
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && a.href) {
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin) {
          e.preventDefault();
          e.stopPropagation();
          recordInfraction('NAVIGATION', `External link blocked: ${url.hostname}`);
          return false;
        }
      }
    }, true);

    const originalOpen = window.open;
    window.open = function(...args) {
      recordInfraction('NEW_TAB', 'window.open blocked');
      return null;
    };

    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form.action) {
        const url = new URL(form.action, location.href);
        if (url.origin !== location.origin) {
          e.preventDefault();
          recordInfraction('NAVIGATION', `External form submission blocked: ${url.hostname}`);
        }
      }
    }, true);
  }

  // === Camera and Face Detection ===
  
  async function setupCameraMonitoring() {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15 }
        }, 
        audio: true 
      });

      const videoEl = document.createElement('video');
      videoEl.id = 'exam-monitor-video';
      videoEl.style.cssText = 'position:fixed;bottom:10px;right:10px;width:160px;height:120px;border:2px solid #0f0;border-radius:8px;z-index:2147483646;';
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = cameraStream;
      videoEl.autoplay = true;
      document.documentElement.appendChild(videoEl);

      const videoTracks = cameraStream.getVideoTracks();
      const audioTracks = cameraStream.getAudioTracks();

      videoTracks.forEach(track => {
        track.addEventListener('ended', () => {
          recordInfraction('CAMERA_OFF', 'Camera track ended');
          stopAllMonitoring();
        });
        
        track.addEventListener('mute', () => {
          recordInfraction('CAMERA_OFF', 'Camera muted');
        });
      });

      startFaceDetection(videoEl);
      startAudioMonitoring(audioTracks[0]);

      setInterval(() => {
        const hasLiveVideo = videoTracks.some(t => t.readyState === 'live' && t.enabled);
        if (!hasLiveVideo) {
          recordInfraction('CAMERA_OFF', 'Camera not live');
        }
      }, 5000);

    } catch (err) {
      // Safe error logging
      try {
        console.error('Camera access error:', err);
      } catch (e) {
        // Console not available, skip logging
      }
      
      const errorMsg = err.message || err.name || 'Camera access denied';
      recordInfraction('CAMERA_OFF', `Camera denied: ${errorMsg}`);
      showWarningOverlay('Camera access is required for exam monitoring!', 'error');
      
      // Retry camera setup after 5 seconds
      setTimeout(() => setupCameraMonitoring(), 5000);
    }
  }

  // === Face Detection using Canvas ===
  
  function startFaceDetection(videoEl) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    let consecutiveNoFace = 0;

    faceDetectionInterval = setInterval(() => {
      if (!videoEl.videoWidth) return;

      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const faceDetected = detectFaceInImageData(imageData);

      if (!faceDetected) {
        consecutiveNoFace++;
        if (consecutiveNoFace >= 3) {
          recordInfraction('NO_FACE', 'Face not visible in camera');
          consecutiveNoFace = 0;
        }
      } else {
        consecutiveNoFace = 0;
      }

      const multipleFaces = detectMultipleFaces(imageData);
      if (multipleFaces) {
        recordInfraction('MULTIPLE_FACES', 'Multiple faces detected');
      }

    }, FACE_CHECK_INTERVAL);
  }

  function detectFaceInImageData(imageData) {
    const { data, width, height } = imageData;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const regionSize = Math.min(width, height) / 4;

    let skinPixels = 0;
    let totalPixels = 0;

    for (let y = centerY - regionSize; y < centerY + regionSize; y++) {
      for (let x = centerX - regionSize; x < centerX + regionSize; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const i = (y * width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          if (r > 95 && g > 40 && b > 20 &&
              r > g && r > b &&
              Math.abs(r - g) > 15) {
            skinPixels++;
          }
          totalPixels++;
        }
      }
    }

    return (skinPixels / totalPixels) > 0.1;
  }

  function detectMultipleFaces(imageData) {
    const { data, width, height } = imageData;
    const regions = [];
    const gridSize = 50;

    for (let gy = 0; gy < height; gy += gridSize) {
      for (let gx = 0; gx < width; gx += gridSize) {
        let brightness = 0;
        let count = 0;

        for (let y = gy; y < Math.min(gy + gridSize, height); y++) {
          for (let x = gx; x < Math.min(gx + gridSize, width); x++) {
            const i = (y * width + x) * 4;
            brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
            count++;
          }
        }

        const avgBrightness = brightness / count;
        if (avgBrightness > 100) {
          regions.push({ x: gx, y: gy, brightness: avgBrightness });
        }
      }
    }

    return regions.length > 3;
  }

  // === Audio Monitoring ===
  
  function startAudioMonitoring(audioTrack) {
    if (!audioTrack) return;

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);

      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let consecutiveNoise = 0;

      audioDetectionInterval = setInterval(() => {
        analyzer.getByteFrequencyData(dataArray);
        
        const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

        if (average > 30) {
          consecutiveNoise++;
          if (consecutiveNoise >= 3) {
            recordInfraction('AUDIO_DETECTED', `Audio level: ${average.toFixed(0)}`);
            consecutiveNoise = 0;
          }
        } else {
          consecutiveNoise = 0;
        }
      }, AUDIO_CHECK_INTERVAL);

    } catch (err) {
      // Silent fail for audio monitoring
      try {
        console.warn('Audio monitoring error:', err);
      } catch (e) {
        // Console not available
      }
    }
  }

  // === Eye Movement Tracking (Simulated) ===
  
  function startEyeTracking(videoEl) {
    let mouseMovements = [];
    let suspiciousPatterns = 0;

    document.addEventListener('mousemove', (e) => {
      mouseMovements.push({ x: e.clientX, y: e.clientY, time: Date.now() });
      if (mouseMovements.length > 50) mouseMovements.shift();
    });

    eyeTrackingInterval = setInterval(() => {
      if (mouseMovements.length < 10) return;

      const recentMoves = mouseMovements.slice(-20);
      let rapidChanges = 0;

      for (let i = 1; i < recentMoves.length; i++) {
        const dx = Math.abs(recentMoves[i].x - recentMoves[i-1].x);
        const dy = Math.abs(recentMoves[i].y - recentMoves[i-1].y);
        const dt = recentMoves[i].time - recentMoves[i-1].time;

        if (dt > 0 && (dx / dt > 2 || dy / dt > 2)) {
          rapidChanges++;
        }
      }

      if (rapidChanges > 10) {
        suspiciousPatterns++;
        if (suspiciousPatterns >= 2) {
          recordInfraction('EYE_MOVEMENT', 'Suspicious rapid eye/mouse movements');
          suspiciousPatterns = 0;
        }
      } else {
        suspiciousPatterns = 0;
      }

      mouseMovements = [];
    }, EYE_CHECK_INTERVAL);
  }

  // === External Application Detection ===
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'tabActivated') {
      if (monitoringActive && msg.url !== location.href) {
        recordInfraction('TAB_SWITCH', `Switched to: ${msg.url}`);
      }
    } else if (msg.type === 'newTabCreated') {
      recordInfraction('NEW_TAB', 'New tab opened');
    } else if (msg.type === 'browserLostFocus') {
      recordInfraction('EXTERNAL_APP', 'Browser lost focus - possible external application');
    }
  });

  // === Initialization ===
  
  function checkBlockedStatus() {
    if (!studentId) return;
    
    chrome.runtime.sendMessage({ type: 'isBlocked', studentId }, response => {
      if (response && response.blocked) {
        // Give user option to use different ID before blocking
        const useNewId = confirm(
          `⚠️ Student ID "${studentId}" is blocked!\n\n` +
          `Block Time: ${response.info.blockedAt}\n` +
          `Reason: ${response.info.reason}\n\n` +
          `Click OK to enter a different ID, or Cancel to see block details.`
        );
        
        if (useNewId) {
          // Clear the blocked ID from localStorage
          try {
            localStorage.removeItem(STUDENT_ID_KEY);
          } catch (e) {}
          
          // Prompt for new ID
          studentId = null;
          location.reload();
        } else {
          // Show block screen
          enforceBlock(response.info);
        }
      }
    });
  }

  function stopAllMonitoring() {
    monitoringActive = false;
    
    if (faceDetectionInterval) clearInterval(faceDetectionInterval);
    if (audioDetectionInterval) clearInterval(audioDetectionInterval);
    if (eyeTrackingInterval) clearInterval(eyeTrackingInterval);
    if (screenShareCheckInterval) clearInterval(screenShareCheckInterval);
    if (monitorCheckInterval) clearInterval(monitorCheckInterval);
    
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  }

  async function initializeMonitoring() {
    studentId = getStudentId();
    
    if (!studentId) {
      studentId = requireStudentId();
      if (!studentId) return;
    }

    // Check if this ID is blocked BEFORE starting monitoring
    chrome.runtime.sendMessage({ type: 'isBlocked', studentId }, response => {
      if (response && response.blocked) {
        // ID is blocked - offer to use different ID
        const switchId = confirm(
          `❌ Student ID "${studentId}" is BLOCKED\n\n` +
          `This ID was blocked at: ${new Date(response.info.blockedAt).toLocaleString()}\n` +
          `Reason: ${response.info.reason}\n` +
          `Total violations: ${response.info.totalInfractions}\n\n` +
          `Would you like to use a different Student ID?\n\n` +
          `Click OK to enter new ID\n` +
          `Click Cancel to see block details`
        );
        
        if (switchId) {
          // Clear blocked ID and reload
          try {
            localStorage.removeItem(STUDENT_ID_KEY);
          } catch (e) {}
          alert('Page will reload. Please enter a new Student ID.');
          location.reload();
          return;
        } else {
          // Show block screen
          enforceBlock(response.info);
          return;
        }
      }
      
      // ID is not blocked - proceed with monitoring
      monitoringActive = true;
      setupClipboardProtection();
      setupVisibilityDetection();
      setupNavigationProtection();
      
      // NEW: Start screen sharing and monitor detection
      startScreenShareMonitoring();
      startMonitorDetection();
      
      setupCameraMonitoring();

      showWarningOverlay('Exam monitoring is now active', 'info');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMonitoring);
  } else {
    initializeMonitoring();
  }

  window.addEventListener('storage', (e) => {
    if (e.key === STUDENT_ID_KEY) {
      studentId = e.newValue;
      checkBlockedStatus();
    }
  });

})();