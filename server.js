import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import emailRoutes from './routes/emailRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import { startAutomatedFollowUp, startCleanupJob } from './services/cronService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Routes
app.use('/api', emailRoutes);
app.use('/api', campaignRoutes);

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start automated services
startAutomatedFollowUp();
startCleanupJob();

// Start server
app.listen(PORT, () => {
    console.log(`🚀 AI Email Automation Server running on port ${PORT}`);
    console.log(`📧 Make sure to set up your environment variables:`);
    console.log(`   - GEMINI_API_KEY: Your Google Gemini API key`);
    console.log(`   - EMAIL_USER: Your Gmail address`);
    console.log(`   - EMAIL_PASS: Your Gmail app-specific password`);
    console.log(`   - GOOGLE_SEARCH_API_KEY: Google Custom Search API key (optional)`);
    console.log(`   - GOOGLE_SEARCH_ENGINE_ID: Google Custom Search Engine ID (optional)`);
    console.log(`\n📁 Make sure the 'public' directory contains your HTML file`);
    console.log(`\n🎯 Ready to automate your job search emails with resume attachments!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});