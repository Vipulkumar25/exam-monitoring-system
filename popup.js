// popup.js - Enhanced control panel with backend integration
const STUDENT_ID_KEY = 'exam_student_id';
const BACKEND_URL = 'http://localhost:3000/api'; // Change for production

function $(id) { 
  return document.getElementById(id); 
}

// ============ BACKEND COMMUNICATION ============

async function fetchFromBackend(endpoint) {
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`);
    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Backend fetch error:', error);
    return null;
  }
}

async function sendToBackend(endpoint, data) {
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Backend send error:', error);
    return null;
  }
}

// ============ STUDENT ID MANAGEMENT ============

async function saveStudentId() {
  const id = $('studentId').value.trim();
  
  if (!id) {
    alert('❌ Please enter a valid student ID');
    return;
  }

  try {
    // Save to localStorage
    localStorage.setItem(STUDENT_ID_KEY, id);
    
    // Check if student has active session in backend
    const studentData = await fetchFromBackend(`/dashboard/student/${id}`);
    
    if (studentData && studentData.success) {
      const activeSessions = studentData.sessions.filter(s => s.isActive);
      
      if (activeSessions.length > 0) {
        const continueSession = confirm(
          `⚠️ Student "${id}" has ${activeSessions.length} active session(s).\n\n` +
          `Do you want to continue the existing session?\n\n` +
          `Click OK to continue, or Cancel to start a new session.`
        );
        
        if (!continueSession) {
          // End existing sessions
          for (const session of activeSessions) {
            await sendToBackend('/session/end', {
              sessionId: session.sessionId,
              studentId: id,
              endTime: new Date().toISOString()
            });
          }
        }
      }
    }
    
    // Broadcast to all tabs
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'studentIdUpdated',
          studentId: id
        }).catch(() => {});
      });
    });

    showNotification(`✅ Student ID "${id}" saved and monitoring is active.`, 'success');
    await updateStatus();
    await loadBackendStats();
    
  } catch (e) {
    showNotification(`❌ Failed to save student ID: ${e.message}`, 'error');
  }
}

// ============ STATUS DISPLAY ============

async function updateStatus() {
  const id = localStorage.getItem(STUDENT_ID_KEY);
  const statusDiv = $('status');
  
  if (!id) {
    statusDiv.innerHTML = `
      <div class="status-item">
        <span class="status-label">Status:</span>
        <span class="status-value status-blocked">No ID Set</span>
      </div>
      <p style="margin-top: 8px; font-size: 11px; color: #888;">
        Please enter and save a student ID to begin monitoring.
      </p>
    `;
    return;
  }

  // Show loading state
  statusDiv.innerHTML = `
    <div class="status-item">
      <span class="status-label">Status:</span>
      <span class="status-value">Loading...</span>
    </div>
  `;

  try {
    // Get extension data
    chrome.runtime.sendMessage({ type: 'getStatus' }, async response => {
      if (!response) {
        statusDiv.innerHTML = `
          <div class="status-item">
            <span class="status-label">Status:</span>
            <span class="status-value status-blocked">Error Loading</span>
          </div>
        `;
        return;
      }

      const infractions = response.infractions || {};
      const blockedIds = response.blockedIds || {};
      
      const studentData = infractions[id];
      const isBlocked = blockedIds[id];
      
      const infractionCount = studentData ? studentData.count : 0;
      const warningCount = studentData ? studentData.warnings : 0;
      
      // Get backend data
      const backendData = await fetchFromBackend(`/dashboard/student/${id}`);
      const backendSessions = backendData?.sessions || [];
      const activeSessions = backendSessions.filter(s => s.isActive);
      const totalBackendInfractions = backendData?.totalInfractions || 0;
      
      let statusHtml = `
        <div class="status-section">
          <h4 style="margin-bottom: 10px; color: #667eea;">📊 Local Status (Extension)</h4>
          <div class="status-item">
            <span class="status-label">Student ID:</span>
            <span class="status-value">${id}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Local Infractions:</span>
            <span class="status-value">${infractionCount}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Warnings:</span>
            <span class="status-value ${warningCount >= 2 ? 'status-blocked' : ''}">${warningCount}/2</span>
          </div>
          <div class="status-item">
            <span class="status-label">Local Status:</span>
            <span class="status-value ${isBlocked ? 'status-blocked' : 'status-ok'}">
              ${isBlocked ? '🚫 BLOCKED' : '✅ Active'}
            </span>
          </div>
        </div>
      `;

      if (isBlocked) {
        statusHtml += `
          <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px;">
            <strong>Blocked At:</strong> ${new Date(isBlocked.blockedAt).toLocaleString()}<br>
            <strong>Reason:</strong> ${isBlocked.reason}
          </div>
        `;
      }

      // Add backend status
      statusHtml += `
        <div class="status-section" style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #e0e0e0;">
          <h4 style="margin-bottom: 10px; color: #764ba2;">🌐 Backend Status (Server)</h4>
          <div class="status-item">
            <span class="status-label">Active Sessions:</span>
            <span class="status-value ${activeSessions.length > 0 ? 'status-ok' : ''}">${activeSessions.length}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Total Sessions:</span>
            <span class="status-value">${backendSessions.length}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Backend Infractions:</span>
            <span class="status-value ${totalBackendInfractions > 0 ? 'status-blocked' : ''}">${totalBackendInfractions}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Server Status:</span>
            <span class="status-value ${backendData ? 'status-ok' : 'status-blocked'}">
              ${backendData ? '✅ Connected' : '❌ Offline'}
            </span>
          </div>
        </div>
      `;

      // Show recent infractions
      if (studentData && studentData.events && studentData.events.length > 0) {
        const recentEvents = studentData.events.slice(-3).reverse();
        statusHtml += `
          <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #e0e0e0;">
            <div style="font-size: 11px; font-weight: 600; color: #555; margin-bottom: 8px;">
              📝 Recent Local Infractions:
            </div>
        `;
        
        recentEvents.forEach(event => {
          const time = new Date(event.time).toLocaleTimeString();
          statusHtml += `
            <div style="font-size: 10px; margin: 5px 0; padding: 5px; background: #f8f9fa; border-radius: 4px; color: #666;">
              <strong>${time}</strong> - ${event.message || event.type}
              ${event.details ? `<br><span style="color: #888;">${event.details}</span>` : ''}
            </div>
          `;
        });
        
        statusHtml += `</div>`;
      }

      // Show active backend sessions
      if (activeSessions.length > 0) {
        statusHtml += `
          <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #e0e0e0;">
            <div style="font-size: 11px; font-weight: 600; color: #555; margin-bottom: 8px;">
              🔴 Active Backend Sessions:
            </div>
        `;
        
        activeSessions.forEach(session => {
          const duration = Math.floor((new Date() - new Date(session.startTime)) / 1000 / 60);
          statusHtml += `
            <div style="font-size: 10px; margin: 5px 0; padding: 8px; background: #d4edda; border-radius: 4px; border-left: 3px solid #28a745;">
              <strong>Session ID:</strong> ${session.sessionId.substring(0, 25)}...<br>
              <strong>Started:</strong> ${new Date(session.startTime).toLocaleString()}<br>
              <strong>Duration:</strong> ${duration} minutes<br>
              <strong>Infractions:</strong> ${session.totalInfractions || 0}<br>
              <strong>Activities:</strong> ${session.totalActivities || 0}
            </div>
          `;
        });
        
        statusHtml += `</div>`;
      }

      statusDiv.innerHTML = statusHtml;
    });
    
  } catch (error) {
    console.error('Status update error:', error);
    statusDiv.innerHTML = `
      <div class="status-item">
        <span class="status-label">Status:</span>
        <span class="status-value status-blocked">Error</span>
      </div>
      <p style="margin-top: 8px; font-size: 11px; color: #dc3545;">
        ${error.message}
      </p>
    `;
  }
}

// ============ BACKEND STATISTICS ============

async function loadBackendStats() {
  try {
    const stats = await fetchFromBackend('/dashboard/stats');
    
    if (!stats || !stats.success) {
      showBackendError();
      return;
    }

    const statsContainer = $('backendStats');
    if (!statsContainer) return;

    statsContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
        <div style="background: #f8f9fa; padding: 10px; border-radius: 6px;">
          <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Active Exams</div>
          <div style="font-size: 20px; font-weight: bold; color: #667eea;">${stats.stats.activeSessions}</div>
        </div>
        <div style="background: #f8f9fa; padding: 10px; border-radius: 6px;">
          <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Total Sessions</div>
          <div style="font-size: 20px; font-weight: bold; color: #764ba2;">${stats.stats.totalSessions}</div>
        </div>
        <div style="background: #f8f9fa; padding: 10px; border-radius: 6px;">
          <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Total Activities</div>
          <div style="font-size: 20px; font-weight: bold; color: #17a2b8;">${stats.stats.totalActivities}</div>
        </div>
        <div style="background: #f8f9fa; padding: 10px; border-radius: 6px;">
          <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Server Status</div>
          <div style="font-size: 14px; font-weight: bold; color: #28a745;">🟢 Online</div>
        </div>
      </div>
    `;

    // Show recent activities
    if (stats.stats.recentActivities && stats.stats.recentActivities.length > 0) {
      const recentContainer = $('recentActivities');
      if (recentContainer) {
        const activities = stats.stats.recentActivities.slice(0, 5);
        recentContainer.innerHTML = `
          <div style="margin-top: 10px;">
            <div style="font-size: 12px; font-weight: 600; color: #555; margin-bottom: 8px;">
              📡 Recent Activities (All Students)
            </div>
            ${activities.map(activity => `
              <div style="font-size: 10px; margin: 5px 0; padding: 6px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid ${getSeverityColor(activity.severity)};">
                <strong>${activity.studentId}</strong> - ${activity.type}
                <br>
                <span style="color: #888;">${new Date(activity.timestamp).toLocaleTimeString()}</span>
                ${activity.details ? `<br><span style="color: #666;">${activity.details}</span>` : ''}
              </div>
            `).join('')}
          </div>
        `;
      }
    }

  } catch (error) {
    console.error('Backend stats error:', error);
    showBackendError();
  }
}

function showBackendError() {
  const statsContainer = $('backendStats');
  if (statsContainer) {
    statsContainer.innerHTML = `
      <div style="padding: 15px; text-align: center; background: #fff3cd; border-radius: 6px; margin-top: 10px;">
        <div style="font-size: 20px; margin-bottom: 8px;">⚠️</div>
        <div style="font-size: 12px; color: #856404; margin-bottom: 8px;">
          <strong>Backend Server Offline</strong>
        </div>
        <div style="font-size: 10px; color: #856404;">
          Extension will continue monitoring locally.<br>
          Data will sync when server is back online.
        </div>
      </div>
    `;
  }
}

function getSeverityColor(severity) {
  const colors = {
    0: '#28a745',
    1: '#17a2b8',
    2: '#ffc107',
    3: '#fd7e14',
    4: '#dc3545',
    5: '#6f42c1'
  };
  return colors[severity] || '#6c757d';
}

// ============ VIEW ALL DATA ============

function viewAllData() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, async response => {
    console.log('=== EXAM LOCKDOWN DATA (LOCAL) ===');
    console.log('All Infractions:', response.infractions);
    console.log('Blocked IDs:', response.blockedIds);
    
    // Get backend data
    const backendStats = await fetchFromBackend('/dashboard/stats');
    console.log('\n=== BACKEND DATA ===');
    console.log('Backend Stats:', backendStats);
    
    const id = localStorage.getItem(STUDENT_ID_KEY);
    if (id) {
      const studentData = await fetchFromBackend(`/dashboard/student/${id}`);
      console.log('\n=== CURRENT STUDENT BACKEND DATA ===');
      console.log('Student Data:', studentData);
    }
    
    console.log('========================\n');
    
    // Create formatted report
    let report = '📊 EXAM MONITORING REPORT\n\n';
    
    report += '=== LOCAL EXTENSION DATA ===\n';
    const infractions = response.infractions || {};
    const blockedIds = response.blockedIds || {};
    
    report += `Total Students Monitored (Local): ${Object.keys(infractions).length}\n`;
    report += `Total Blocked IDs (Local): ${Object.keys(blockedIds).length}\n\n`;
    
    Object.keys(infractions).forEach(studentId => {
      const data = infractions[studentId];
      report += `\nStudent: ${studentId}\n`;
      report += `  Total Infractions: ${data.count}\n`;
      report += `  Warnings: ${data.warnings}\n`;
      report += `  Status: ${blockedIds[studentId] ? 'BLOCKED' : 'Active'}\n`;
      
      if (data.events && data.events.length > 0) {
        report += `  Recent Events:\n`;
        data.events.slice(-5).forEach(evt => {
          report += `    - ${new Date(evt.time).toLocaleString()}: ${evt.message}\n`;
        });
      }
    });
    
    if (backendStats && backendStats.success) {
      report += '\n=== BACKEND SERVER DATA ===\n';
      report += `Active Sessions: ${backendStats.stats.activeSessions}\n`;
      report += `Total Sessions: ${backendStats.stats.totalSessions}\n`;
      report += `Total Activities: ${backendStats.stats.totalActivities}\n\n`;
      
      if (backendStats.stats.infractionStats.length > 0) {
        report += 'Infraction Breakdown:\n';
        backendStats.stats.infractionStats.forEach(stat => {
          report += `  - ${stat._id}: ${stat.count}\n`;
        });
      }
    }
    
    console.log(report);
    
    showNotification(
      '📊 Full report logged to console. Open DevTools (F12) to view.',
      'info'
    );
  });
}

// ============ OPEN DASHBOARD ============

function openDashboard() {
  const dashboardUrl = BACKEND_URL.replace('/api', '/dashboard');
  chrome.tabs.create({ url: dashboardUrl });
}

// ============ UNBLOCK STUDENT ============

function unblockStudent() {
  const id = localStorage.getItem(STUDENT_ID_KEY);
  
  if (!id) {
    showNotification('❌ No student ID is currently set.', 'error');
    return;
  }

  if (!confirm(`Are you sure you want to unblock student "${id}"?\n\nThis will reset their infractions and warnings.`)) {
    return;
  }

  chrome.runtime.sendMessage({ type: 'unblockId', studentId: id }, response => {
    if (response && response.ok) {
      showNotification(`✅ Student "${id}" has been unblocked successfully.`, 'success');
      updateStatus();
      loadBackendStats();
    } else {
      showNotification('❌ Failed to unblock student.', 'error');
    }
  });
}

// ============ CLEAR ALL DATA ============

async function clearAllData() {
  if (!confirm('⚠️ WARNING: This will delete ALL monitoring data for ALL students.\n\nAre you absolutely sure?')) {
    return;
  }

  const confirmText = prompt('Type "DELETE" to confirm:');
  if (confirmText !== 'DELETE') {
    showNotification('❌ Action cancelled.', 'info');
    return;
  }

  try {
    // Clear extension data
    chrome.runtime.sendMessage({ type: 'clearAllData' }, response => {
      if (response && response.ok) {
        showNotification('🗑️ Local data cleared successfully.', 'success');
        updateStatus();
      }
    });

    // Note: We don't clear backend data from extension
    // That should be done from the dashboard
    showNotification(
      '✅ Local extension data has been cleared.\n\n' +
      'To clear backend data, use the dashboard admin panel.',
      'info'
    );
    
    setTimeout(() => {
      updateStatus();
      loadBackendStats();
    }, 1000);
    
  } catch (error) {
    showNotification(`❌ Error: ${error.message}`, 'error');
  }
}

// ============ REFRESH STATUS ============

function refreshStatus() {
  const btn = $('refreshBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="icon">⏳</span>Refreshing...';
  btn.disabled = true;
  
  Promise.all([
    updateStatus(),
    loadBackendStats()
  ]).then(() => {
    btn.innerHTML = originalText;
    btn.disabled = false;
    showNotification('✅ Status refreshed', 'success');
  }).catch(error => {
    btn.innerHTML = originalText;
    btn.disabled = false;
    showNotification('❌ Refresh failed', 'error');
  });
}

// ============ TEST BACKEND CONNECTION ============

async function testBackendConnection() {
  const testBtn = $('testBackendBtn');
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
  }

  try {
    const stats = await fetchFromBackend('/dashboard/stats');
    
    if (stats && stats.success) {
      showNotification(
        `✅ Backend Connected!\n\n` +
        `Active Sessions: ${stats.stats.activeSessions}\n` +
        `Server URL: ${BACKEND_URL}`,
        'success'
      );
    } else {
      showNotification(
        `❌ Backend Unreachable\n\n` +
        `URL: ${BACKEND_URL}\n` +
        `Make sure server is running: npm start`,
        'error'
      );
    }
  } catch (error) {
    showNotification(
      `❌ Connection Failed\n\n` +
      `Error: ${error.message}\n` +
      `URL: ${BACKEND_URL}`,
      'error'
    );
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = '🔌 Test Backend';
    }
  }
}

// ============ NOTIFICATIONS ============

function showNotification(message, type = 'info') {
  const colors = {
    success: '#28a745',
    error: '#dc3545',
    warning: '#ffc107',
    info: '#17a2b8'
  };

  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 10000;
    max-width: 300px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ============ EVENT LISTENERS ============

document.addEventListener('DOMContentLoaded', () => {
  // Button event listeners
  $('saveBtn').addEventListener('click', saveStudentId);
  $('viewAllBtn').addEventListener('click', viewAllData);
  $('unblockBtn').addEventListener('click', unblockStudent);
  $('clearAllBtn').addEventListener('click', clearAllData);
  $('refreshBtn').addEventListener('click', refreshStatus);
  
  // Dashboard button
  const dashboardBtn = $('openDashboardBtn');
  if (dashboardBtn) {
    dashboardBtn.addEventListener('click', openDashboard);
  }

  // Test backend button
  const testBackendBtn = $('testBackendBtn');
  if (testBackendBtn) {
    testBackendBtn.addEventListener('click', testBackendConnection);
  }

  // Load saved student ID
  const savedId = localStorage.getItem(STUDENT_ID_KEY);
  if (savedId) {
    $('studentId').value = savedId;
  }

  // Enter key in student ID input
  $('studentId').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveStudentId();
    }
  });

  // Initial status update
  updateStatus();
  loadBackendStats();

  // Auto-refresh every 10 seconds
  setInterval(() => {
    updateStatus();
    loadBackendStats();
  }, 10000);

  // Check backend connection on startup
  setTimeout(testBackendConnection, 1000);
});