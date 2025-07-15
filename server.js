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
import './config/database.js'; // Initialize database connection
import passport from './config/passport.js';

// Import routes - FIXED: Use consistent default imports
import authRoutes from './routes/authRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';

// Import services
import { startAutomatedFollowUp, startCleanupJob, startHealthCheck } from './services/cronService.js';

// Import middleware
import { securityHeaders, handleCORS } from './middleware/authMiddleware.js';

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
    origin: ['https://www.redlinear.com', 'http://localhost:3001'], // Allow both production and dev
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
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: false,
    saveUninitialized: false,
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

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const { query } = await import('./config/database.js');
        await query('SELECT 1');
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        message: 'AI Email Automation API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        features: {
            authentication: 'Google OAuth 2.0',
            database: 'PostgreSQL',
            ai: 'Google Gemini',
            email: 'Gmail SMTP',
            scheduling: 'Cron Jobs'
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

    // Default error response
    res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : error.message 
    });
});

// Start automated services
console.log('🤖 Starting automated services...');
startAutomatedFollowUp();
startCleanupJob();
startHealthCheck();

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
    console.log(`\n🎯 Ready to automate job search emails with user authentication!`);
    console.log(`\n📖 API Endpoints:`);
    console.log(`   🔐 Authentication: /auth/*`);
    console.log(`   📧 Email Operations: /api/*`);
    console.log(`   📊 Campaign Management: /api/campaigns/*`);
    console.log(`   🏥 Health Check: /health`);
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