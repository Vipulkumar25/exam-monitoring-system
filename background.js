// background.js - Service worker for exam monitoring
const INFRACTION_THRESHOLD = 2;

// Infraction types and their severity
const INFRACTION_TYPES = {
  TAB_SWITCH: { severity: 3, message: 'Tab switching detected' },
  WINDOW_BLUR: { severity: 2, message: 'Window lost focus' },
  CAMERA_OFF: { severity: 5, message: 'Camera turned off' },
  NO_FACE: { severity: 4, message: 'Face not detected in camera' },
  MULTIPLE_FACES: { severity: 5, message: 'Multiple faces detected' },
  EYE_MOVEMENT: { severity: 3, message: 'Suspicious eye movements detected' },
  AUDIO_DETECTED: { severity: 3, message: 'Background audio/conversation detected' },
  COPY_PASTE: { severity: 4, message: 'Copy/paste attempt blocked' },
  NAVIGATION: { severity: 5, message: 'Navigation attempt blocked' },
  NEW_TAB: { severity: 5, message: 'New tab/window attempt blocked' },
  EXTERNAL_APP: { severity: 5, message: 'Unauthorized application detected' },
  SCREEN_SHARE: { severity: 5, message: 'Screen sharing software detected' },
  MULTIPLE_MONITORS: { severity: 5, message: 'Multiple monitors detected' },
  REMOTE_DESKTOP: { severity: 5, message: 'Remote desktop access detected' }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['blockedIds', 'infractions'], result => {
    if (!result.blockedIds) chrome.storage.local.set({ blockedIds: {} });
    if (!result.infractions) chrome.storage.local.set({ infractions: {} });
  });
});

// Show desktop notification
function showNotification(title, message, isError = false) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message,
    priority: isError ? 2 : 1
  });
}

// Monitor tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.url) {
      // Notify content script about potential tab switch
      chrome.tabs.sendMessage(activeInfo.tabId, {
        type: 'tabActivated',
        url: tab.url
      }).catch(() => {});
    }
  });
});

// Monitor new tabs/windows
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId) {
    chrome.tabs.sendMessage(tab.openerTabId, {
      type: 'newTabCreated'
    }).catch(() => {});
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'recordInfraction') {
    const { studentId, infractionType, details } = msg;
    
    if (!studentId) {
      sendResponse({ ok: false, reason: 'no-id' });
      return true;
    }

    chrome.storage.local.get(['infractions', 'blockedIds'], data => {
      const infractions = data.infractions || {};
      const blockedIds = data.blockedIds || {};

      // Check if already blocked
      if (blockedIds[studentId]) {
        sendResponse({ ok: false, blocked: true, reason: 'already-blocked' });
        return;
      }

      // Initialize student record
      if (!infractions[studentId]) {
        infractions[studentId] = { 
          count: 0, 
          events: [],
          warnings: 0 
        };
      }

      // Get infraction info
      const infractionInfo = INFRACTION_TYPES[infractionType] || { 
        severity: 1, 
        message: 'Unknown infraction' 
      };

      // Record infraction
      infractions[studentId].count += 1;
      infractions[studentId].warnings += 1;
      infractions[studentId].events.push({
        type: infractionType,
        severity: infractionInfo.severity,
        message: infractionInfo.message,
        details: details || '',
        time: new Date().toISOString(),
        page: msg.page || ''
      });

      let response = { 
        ok: true, 
        infractions: infractions[studentId].count,
        warnings: infractions[studentId].warnings,
        message: infractionInfo.message
      };

      // Show warning notification
      showNotification(
        `Warning ${infractions[studentId].warnings}/${INFRACTION_THRESHOLD}`,
        infractionInfo.message,
        false
      );

      // Block if reached threshold
      if (infractions[studentId].warnings > INFRACTION_THRESHOLD) {
        blockedIds[studentId] = { 
          blockedAt: new Date().toISOString(), 
          reason: 'Exceeded infraction threshold',
          totalInfractions: infractions[studentId].count,
          lastEvents: infractions[studentId].events.slice(-5)
        };
        
        showNotification(
          '🚫 STUDENT BLOCKED',
          `Student ${studentId} has been permanently blocked due to ${infractions[studentId].warnings} violations.`,
          true
        );
        
        response.blocked = true;
        response.blockReason = blockedIds[studentId].reason;
      }

      chrome.storage.local.set({ infractions, blockedIds }, () => {
        sendResponse(response);
      });
    });
    
    return true; // Keep channel open for async response
  } 
  
  else if (msg.type === 'isBlocked') {
    const { studentId } = msg;
    chrome.storage.local.get(['blockedIds'], data => {
      const blocked = data.blockedIds && data.blockedIds[studentId];
      sendResponse({ blocked: !!blocked, info: blocked || null });
    });
    return true;
  } 
  
  else if (msg.type === 'getStatus') {
    chrome.storage.local.get(['infractions', 'blockedIds'], data => {
      sendResponse({ 
        infractions: data.infractions || {}, 
        blockedIds: data.blockedIds || {} 
      });
    });
    return true;
  } 
  
  else if (msg.type === 'unblockId') {
    const { studentId } = msg;
    chrome.storage.local.get(['blockedIds', 'infractions'], data => {
      const blockedIds = data.blockedIds || {};
      const infractions = data.infractions || {};
      
      delete blockedIds[studentId];
      if (infractions[studentId]) {
        infractions[studentId].count = 0;
        infractions[studentId].warnings = 0;
      }
      
      chrome.storage.local.set({ blockedIds, infractions }, () => {
        showNotification('Student Unblocked', `Student ${studentId} has been unblocked.`);
        sendResponse({ ok: true });
      });
    });
    return true;
  }
  
  else if (msg.type === 'clearAllData') {
    chrome.storage.local.set({ infractions: {}, blockedIds: {} }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// Monitor for external applications (system-level detection is limited in extensions)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus - user might be in another application
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'browserLostFocus'
        }).catch(() => {});
      }
    });
  }
});