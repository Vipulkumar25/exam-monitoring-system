// server.js - Backend server for exam monitoring
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/exam_monitoring', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// ============ DATABASE SCHEMAS ============

// Exam Session Schema
const ExamSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  studentId: { type: String, required: true, index: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  isActive: { type: Boolean, default: true },
  browserInfo: {
    userAgent: String,
    platform: String,
    language: String,
    screenResolution: String,
    timezone: String
  },
  totalInfractions: { type: Number, default: 0 },
  totalActivities: { type: Number, default: 0 },
  lastHeartbeat: { type: Date, default: Date.now }
});

const ExamSession = mongoose.model('ExamSession', ExamSessionSchema);

// Activity Log Schema
const ActivityLogSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  studentId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  type: { type: String, required: true },
  severity: { type: Number, default: 0 },
  infractionType: String,
  details: String,
  page: String,
  software: String,
  action: String,
  screenData: Object,
  position: Object,
  error: String,
  shortcut: String,
  duration: Number,
  hidden: Boolean,
  targetUrl: String
});

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

// System Info Schema
const SystemInfoSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  studentId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  activeTab: String,
  currentUrl: String,
  windowFocused: Boolean,
  visibility: String,
  screenInfo: Object,
  battery: Object,
  connection: Object
});

const SystemInfo = mongoose.model('SystemInfo', SystemInfoSchema);

// ============ API ROUTES ============

// Start exam session
app.post('/api/session/start', async (req, res) => {
  try {
    const { studentId, startTime, browserInfo } = req.body;
    
    const sessionId = `SESSION_${studentId}_${Date.now()}`;
    
    const session = new ExamSession({
      sessionId,
      studentId,
      startTime: new Date(startTime),
      browserInfo,
      isActive: true
    });
    
    await session.save();
    
    // Emit to dashboard
    io.emit('session_started', {
      sessionId,
      studentId,
      startTime,
      browserInfo
    });
    
    res.json({ 
      success: true, 
      sessionId,
      message: 'Session started successfully' 
    });
  } catch (error) {
    console.error('Session start error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// End exam session
app.post('/api/session/end', async (req, res) => {
  try {
    const { sessionId, studentId, endTime } = req.body;
    
    const session = await ExamSession.findOneAndUpdate(
      { sessionId },
      { 
        endTime: new Date(endTime),
        isActive: false
      },
      { new: true }
    );
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    // Emit to dashboard
    io.emit('session_ended', {
      sessionId,
      studentId,
      endTime
    });
    
    res.json({ success: true, message: 'Session ended' });
  } catch (error) {
    console.error('Session end error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log single activity
app.post('/api/activity/log', async (req, res) => {
  try {
    const activityData = req.body;
    
    const activity = new ActivityLog(activityData);
    await activity.save();
    
    // Update session infraction count if it's an infraction
    if (activityData.type === 'INFRACTION') {
      await ExamSession.findOneAndUpdate(
        { sessionId: activityData.sessionId },
        { $inc: { totalInfractions: 1, totalActivities: 1 } }
      );
    } else {
      await ExamSession.findOneAndUpdate(
        { sessionId: activityData.sessionId },
        { $inc: { totalActivities: 1 } }
      );
    }
    
    // Emit to dashboard in real-time
    io.emit('activity_logged', activityData);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log bulk activities
app.post('/api/activity/bulk', async (req, res) => {
  try {
    const { sessionId, studentId, activities } = req.body;
    
    if (!activities || activities.length === 0) {
      return res.json({ success: true, count: 0 });
    }
    
    // Insert all activities
    const result = await ActivityLog.insertMany(activities);
    
    // Count infractions
    const infractionCount = activities.filter(a => a.type === 'INFRACTION').length;
    
    // Update session
    await ExamSession.findOneAndUpdate(
      { sessionId },
      { 
        $inc: { 
          totalInfractions: infractionCount,
          totalActivities: activities.length
        }
      }
    );
    
    // Emit to dashboard
    activities.forEach(activity => {
      io.emit('activity_logged', activity);
    });
    
    res.json({ 
      success: true, 
      count: result.length,
      infractions: infractionCount
    });
  } catch (error) {
    console.error('Bulk activity error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Heartbeat endpoint
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { sessionId, studentId, timestamp, systemInfo } = req.body;
    
    // Update session last heartbeat
    await ExamSession.findOneAndUpdate(
      { sessionId },
      { lastHeartbeat: new Date(timestamp) }
    );
    
    // Save system info
    const sysInfo = new SystemInfo({
      sessionId,
      studentId,
      timestamp: new Date(timestamp),
      ...systemInfo
    });
    await sysInfo.save();
    
    // Emit to dashboard
    io.emit('heartbeat', {
      sessionId,
      studentId,
      timestamp,
      systemInfo
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DASHBOARD API ROUTES ============

// Get all active sessions
app.get('/api/dashboard/sessions/active', async (req, res) => {
  try {
    const sessions = await ExamSession.find({ isActive: true })
      .sort({ startTime: -1 })
      .lean();
    
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all sessions (with pagination)
app.get('/api/dashboard/sessions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const sessions = await ExamSession.find()
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await ExamSession.countDocuments();
    
    res.json({ 
      success: true, 
      sessions,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get session details
app.get('/api/dashboard/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await ExamSession.findOne({ sessionId }).lean();
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    const activities = await ActivityLog.find({ sessionId })
      .sort({ timestamp: -1 })
      .lean();
    
    const systemInfo = await SystemInfo.find({ sessionId })
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();
    
    res.json({
      success: true,
      session,
      activities,
      systemInfo
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get student history
app.get('/api/dashboard/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const sessions = await ExamSession.find({ studentId })
      .sort({ startTime: -1 })
      .lean();
    
    const activities = await ActivityLog.find({ studentId })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    
    res.json({
      success: true,
      studentId,
      sessions,
      activities,
      totalSessions: sessions.length,
      totalInfractions: sessions.reduce((sum, s) => sum + (s.totalInfractions || 0), 0)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get real-time statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const activeSessions = await ExamSession.countDocuments({ isActive: true });
    const totalSessions = await ExamSession.countDocuments();
    const totalActivities = await ActivityLog.countDocuments();
    
    // Get infraction statistics
    const infractionStats = await ActivityLog.aggregate([
      { $match: { type: 'INFRACTION' } },
      { $group: { _id: '$infractionType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Get recent activities
    const recentActivities = await ActivityLog.find()
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();
    
    res.json({
      success: true,
      stats: {
        activeSessions,
        totalSessions,
        totalActivities,
        infractionStats,
        recentActivities
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search students
app.get('/api/dashboard/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.json({ success: true, results: [] });
    }
    
    const sessions = await ExamSession.find({
      studentId: { $regex: query, $options: 'i' }
    })
    .sort({ startTime: -1 })
    .limit(20)
    .lean();
    
    res.json({ success: true, results: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ WEBSOCKET CONNECTION ============

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  
  socket.on('subscribe_session', (sessionId) => {
    socket.join(`session_${sessionId}`);
    console.log(`Client subscribed to session: ${sessionId}`);
  });
  
  socket.on('unsubscribe_session', (sessionId) => {
    socket.leave(`session_${sessionId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Dashboard disconnected:', socket.id);
  });
});

// ============ SERVER START ============

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ Exam Monitoring Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down server...');
  await mongoose.connection.close();
  server.close(() => {
    console.log('✅ Server shut down successfully');
    process.exit(0);
  });
});