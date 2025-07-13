import express from 'express';
import multer from 'multer';
import { emailController } from '../controllers/emailController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

// File filter for PDF only
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// All email routes require authentication
router.use(authenticateToken);

// Routes - Check if all controller methods exist
router.post('/send-email', upload.single('resume'), (req, res, next) => {
    if (typeof emailController.sendEmail === 'function') {
        emailController.sendEmail(req, res, next);
    } else {
        console.error('emailController.sendEmail is not a function');
        res.status(500).json({ error: 'Internal server error - sendEmail method not found' });
    }
});

router.get('/campaigns', (req, res, next) => {
    if (typeof emailController.getUserCampaigns === 'function') {
        emailController.getUserCampaigns(req, res, next);
    } else {
        console.error('emailController.getUserCampaigns is not a function');
        res.status(500).json({ error: 'Internal server error - getUserCampaigns method not found' });
    }
});

router.get('/campaigns/search', (req, res, next) => {
    if (typeof emailController.searchCampaigns === 'function') {
        emailController.searchCampaigns(req, res, next);
    } else {
        console.error('emailController.searchCampaigns is not a function');
        res.status(500).json({ error: 'Internal server error - searchCampaigns method not found' });
    }
});

router.get('/campaigns/stats', (req, res, next) => {
    if (typeof emailController.getCampaignStats === 'function') {
        emailController.getCampaignStats(req, res, next);
    } else {
        console.error('emailController.getCampaignStats is not a function');
        res.status(500).json({ error: 'Internal server error - getCampaignStats method not found' });
    }
});

router.delete('/campaigns/:id', (req, res, next) => {
    if (typeof emailController.deleteCampaign === 'function') {
        emailController.deleteCampaign(req, res, next);
    } else {
        console.error('emailController.deleteCampaign is not a function');
        res.status(500).json({ error: 'Internal server error - deleteCampaign method not found' });
    }
});

export default router;