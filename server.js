import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';

// Import configurations
import './config/database.js'; 
import passport from './config/passport.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';

// Import middleware
import { securityHeaders, handleCORS, authenticateToken } from './middleware/authMiddleware.js';

// Import services - UPDATED: Include threading maintenance
import { 
    startAutomatedFollowUp, 
    startCleanupJob, 
    startHealthCheck,
    startThreadingMaintenance  // 🔥 NEW: Threading maintenance service
} from './services/cronService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (important for production behind reverse proxy)
app.set('trust proxy', 1);

// Apply security middleware
app.use(securityHeaders);
app.use(handleCORS);

// Session store using PostgreSQL
const PgSession = connectPgSimple(session);

// Middleware
app.use(cors({
    origin: ['https://www.mmcgroups.com', 'http://localhost:3001'], // Allow both production and dev
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['set-cookie']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Session configuration
app.use(session({
    store: new PgSession({
        conString: `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
        tableName: 'session',
        pruneSessionInterval: 60 * 15, // Prune expired sessions every 15 minutes
        ttl: 7 * 24 * 60 * 60 // 7 days TTL
    }),
    name: 'connect.sid', // Explicitly set session name
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiration on activity
    cookie: {
        secure: true,  // Always true for HTTPS
        httpOnly: true,
        sameSite: 'none',  // Required for cross-origin
        maxAge: 7 * 24 * 60 * 60 * 1000,
        domain: undefined  // Don't set domain for cross-origin
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Serve static files
app.use(express.static('public'));

// Create required directories
const requiredDirs = ['uploads', 'public'];
requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created ${dir} directory`);
    }
});

// API Routes
app.use('/auth', authRoutes);
app.use('/api', emailRoutes);
app.use('/api', campaignRoutes);

// 🔥 NEW: Threading-specific API endpoints
app.get('/api/threading/stats/:campaignId', authenticateToken, async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { campaignRepository } = await import('./repositories/campaignRepository.js');
        
        const emailThread = await campaignRepository.getEmailThread(campaignId, req.user.user_id);
        
        if (!emailThread) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const threadingStats = {
            hasOriginalEmail: !!emailThread.original.messageId,
            followUpCount: emailThread.followUps.length,
            threadId: emailThread.original.threadId,
            isThreaded: !!(emailThread.original.messageId && emailThread.original.threadId),
            followUps: emailThread.followUps.map(followUp => ({
                followUpNumber: followUp.followUpNumber,
                messageId: followUp.messageId,
                inReplyTo: followUp.inReplyTo,
                sentAt: followUp.sentAt,
                isProperlyThreaded: followUp.inReplyTo === emailThread.original.messageId
            }))
        };

        res.json({
            success: true,
            threadingStats,
            emailThread
        });
    } catch (error) {
        console.error('Error getting threading stats:', error);
        res.status(500).json({ error: 'Failed to get threading statistics' });
    }
});

// 🔥 NEW: Threading health check endpoint
app.get('/api/threading/health', authenticateToken, async (req, res) => {
    try {
        const { query } = await import('./config/database.js');
        
        // Check campaigns with threading information
        const threadingHealth = await query(`
            SELECT 
                COUNT(*) as total_sent_campaigns,
                COUNT(CASE WHEN message_id IS NOT NULL THEN 1 END) as campaigns_with_message_id,
                COUNT(CASE WHEN thread_id IS NOT NULL THEN 1 END) as campaigns_with_thread_id,
                COUNT(CASE WHEN message_id IS NOT NULL AND thread_id IS NOT NULL THEN 1 END) as fully_threaded_campaigns
            FROM campaigns 
            WHERE user_id = $1 AND status = 'sent'
        `, [req.user.user_id]);

        const followUpHealth = await query(`
            SELECT 
                COUNT(*) as total_follow_ups,
                COUNT(CASE WHEN in_reply_to IS NOT NULL THEN 1 END) as follow_ups_with_reply_to,
                COUNT(CASE WHEN references IS NOT NULL THEN 1 END) as follow_ups_with_references
            FROM campaign_followups cf
            JOIN campaigns c ON cf.campaign_id = c.id
            WHERE c.user_id = $1
        `, [req.user.user_id]);

        const stats = threadingHealth.rows[0];
        const followUpStats = followUpHealth.rows[0];

        const threadingRate = stats.total_sent_campaigns > 0 ? 
            ((stats.fully_threaded_campaigns / stats.total_sent_campaigns) * 100).toFixed(1) : 0;

        const followUpThreadingRate = followUpStats.total_follow_ups > 0 ? 
            ((followUpStats.follow_ups_with_reply_to / followUpStats.total_follow_ups) * 100).toFixed(1) : 0;

        res.json({
            success: true,
            threadingHealth: {
                totalSentCampaigns: parseInt(stats.total_sent_campaigns),
                campaignsWithMessageId: parseInt(stats.campaigns_with_message_id),
                campaignsWithThreadId: parseInt(stats.campaigns_with_thread_id),
                fullyThreadedCampaigns: parseInt(stats.fully_threaded_campaigns),
                threadingRate: parseFloat(threadingRate),
                totalFollowUps: parseInt(followUpStats.total_follow_ups),
                followUpsWithReplyTo: parseInt(followUpStats.follow_ups_with_reply_to),
                followUpsWithReferences: parseInt(followUpStats.follow_ups_with_references),
                followUpThreadingRate: parseFloat(followUpThreadingRate)
            }
        });
    } catch (error) {
        console.error('Error getting threading health:', error);
        res.status(500).json({ error: 'Failed to get threading health information' });
    }
});

// 🔥 NEW: Get full email thread for a campaign
app.get('/api/threading/thread/:campaignId', authenticateToken, async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { campaignRepository } = await import('./repositories/campaignRepository.js');
        
        const emailThread = await campaignRepository.getEmailThread(campaignId, req.user.user_id);
        
        if (!emailThread) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({
            success: true,
            thread: emailThread
        });
    } catch (error) {
        console.error('Error getting email thread:', error);
        res.status(500).json({ error: 'Failed to get email thread' });
    }
});

// 🔥 NEW: Validate threading integrity for user's campaigns
app.get('/api/threading/validate', authenticateToken, async (req, res) => {
    try {
        const { query } = await import('./config/database.js');
        
        // Find campaigns with potential threading issues
        const threadingIssues = await query(`
            SELECT 
                c.id,
                c.company_name,
                c.job_title,
                c.status,
                c.message_id,
                c.thread_id,
                c.follow_up_count,
                COUNT(cf.id) as actual_follow_ups
            FROM campaigns c
            LEFT JOIN campaign_followups cf ON c.id = cf.campaign_id
            WHERE c.user_id = $1 AND c.status = 'sent'
            GROUP BY c.id, c.company_name, c.job_title, c.status, c.message_id, c.thread_id, c.follow_up_count
            HAVING (
                (c.message_id IS NULL OR c.thread_id IS NULL) OR
                (c.follow_up_count != COUNT(cf.id))
            )
        `, [req.user.user_id]);

        const orphanedFollowUps = await query(`
            SELECT cf.id, cf.campaign_id, cf.followup_number
            FROM campaign_followups cf
            LEFT JOIN campaigns c ON cf.campaign_id = c.id
            WHERE cf.user_id = $1 AND c.id IS NULL
        `, [req.user.user_id]);

        res.json({
            success: true,
            validation: {
                campaignsWithIssues: threadingIssues.rows,
                orphanedFollowUps: orphanedFollowUps.rows,
                totalIssues: threadingIssues.rows.length + orphanedFollowUps.rows.length
            }
        });
    } catch (error) {
        console.error('Error validating threading:', error);
        res.status(500).json({ error: 'Failed to validate threading integrity' });
    }
});

// 🔥 NEW: Gmail threading statistics (if Gmail service is available)
app.get('/api/threading/gmail-stats', authenticateToken, async (req, res) => {
    try {
        const { gmailService } = await import('./services/gmailService.js');
        
        const hasPermissions = await gmailService.hasGmailPermissions(req.user.user_id);
        
        if (!hasPermissions) {
            return res.json({
                success: true,
                hasGmailAccess: false,
                message: 'Gmail access not granted'
            });
        }

        const threadingStats = await gmailService.getThreadingStats(req.user.user_id);
        
        res.json({
            success: true,
            hasGmailAccess: true,
            gmailThreadingStats: threadingStats
        });
    } catch (error) {
        console.error('Error getting Gmail threading stats:', error);
        res.status(500).json({ error: 'Failed to get Gmail threading statistics' });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const { query } = await import('./config/database.js');
        await query('SELECT 1');
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            features: {
                emailThreading: true,
                followUpThreading: true,
                threadingMaintenance: true
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API status endpoint - UPDATED: Include threading features
app.get('/api/status', (req, res) => {
    res.json({
        message: 'AI Email Automation API is running',
        version: '2.0.0', // Updated version with threading support
        timestamp: new Date().toISOString(),
        features: {
            authentication: 'Google OAuth 2.0',
            database: 'PostgreSQL',
            ai: 'Google Gemini',
            email: 'Gmail SMTP',
            scheduling: 'Cron Jobs',
            threading: 'RFC-compliant Email Threading', // 🔥 NEW
            followUpThreading: 'Automated Threaded Follow-ups', // 🔥 NEW
            threadMaintenance: 'Threading Integrity Monitoring' // 🔥 NEW
        },
        threading: {
            messageIdGeneration: true,
            inReplyToSupport: true,
            referencesChaining: true,
            threadIdTracking: true,
            gmailThreading: true,
            automatedMaintenance: true
        }
    });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route for SPA (if using React/Vue frontend)
app.get('*', (req, res) => {
    // Only serve index.html for non-API routes
    if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) {
        const indexPath = path.join(__dirname, 'public', 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(404).json({ error: 'Page not found' });
        }
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

// Global error handling middleware
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    
    // Handle multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
            error: 'File too large. Maximum size is 10MB.' 
        });
    }
    
    if (error.message === 'Only PDF files are allowed') {
        return res.status(400).json({ 
            error: 'Only PDF files are allowed for resume uploads.' 
        });
    }

    // Handle JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token' });
    }

    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
    }

    // Database errors
    if (error.code && error.code.startsWith('23')) { // PostgreSQL constraint errors
        return res.status(400).json({ 
            error: 'Database constraint violation' 
        });
    }

    // 🔥 NEW: Threading-specific errors
    if (error.message && error.message.includes('threading')) {
        return res.status(400).json({ 
            error: 'Email threading error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }

    // Default error response
    res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : error.message 
    });
});

// Start automated services - UPDATED: Include threading maintenance
console.log('🤖 Starting automated services...');
startAutomatedFollowUp();
startCleanupJob();
startHealthCheck();
startThreadingMaintenance(); // 🔥 NEW: Start threading maintenance

// Graceful shutdown
const gracefulShutdown = async () => {
    console.log('📥 Received shutdown signal. Shutting down gracefully...');
    
    try {
        // Close database connections
        const { end } = await import('./config/database.js');
        await end();
        console.log('✅ Database connections closed');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};

// Start server
app.listen(PORT, () => {
    console.log(`🚀 AI Email Automation Server running on port ${PORT}`);
    console.log(`📧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    console.log(`\n📋 Required Environment Variables:`);
    console.log(`   ✅ PORT: ${PORT}`);
    console.log(`   ${process.env.DB_HOST ? '✅' : '❌'} DB_HOST: Database host`);
    console.log(`   ${process.env.GEMINI_API_KEY ? '✅' : '❌'} GEMINI_API_KEY: Google Gemini API key`);
    console.log(`   ${process.env.EMAIL_USER ? '✅' : '❌'} EMAIL_USER: Gmail address`);
    console.log(`   ${process.env.EMAIL_PASS ? '✅' : '❌'} EMAIL_PASS: Gmail app password`);
    console.log(`   ${process.env.GOOGLE_CLIENT_ID ? '✅' : '❌'} GOOGLE_CLIENT_ID: Google OAuth client ID`);
    console.log(`   ${process.env.GOOGLE_CLIENT_SECRET ? '✅' : '❌'} GOOGLE_CLIENT_SECRET: Google OAuth secret`);
    console.log(`   ${process.env.JWT_SECRET ? '✅' : '❌'} JWT_SECRET: JWT signing secret`);
    console.log(`   ${process.env.ENCRYPTION_KEY ? '✅' : '❌'} ENCRYPTION_KEY: Data encryption key`); // 🔥 NEW
    console.log(`\n🎯 Ready to automate job search emails with user authentication!`);
    console.log(`\n📖 API Endpoints:`);
    console.log(`   🔐 Authentication: /auth/*`);
    console.log(`   📧 Email Operations: /api/*`);
    console.log(`   📊 Campaign Management: /api/campaigns/*`);
    console.log(`   🔗 Threading Operations: /api/threading/*`); // 🔥 NEW
    console.log(`   🏥 Health Check: /health`);
    console.log(`\n🔗 Threading Features:`); // 🔥 NEW
    console.log(`   📧 RFC-compliant email threading`);
    console.log(`   🔄 Automated threaded follow-ups`);
    console.log(`   📊 Threading health monitoring`);
    console.log(`   🔧 Threading integrity maintenance`);
    console.log(`   📈 Gmail threading statistics`);
});

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown();
});