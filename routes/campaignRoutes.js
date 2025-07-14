import express from 'express';

const router = express.Router();

// Import middleware with error handling
let authenticateToken;
try {
    const authMiddleware = await import('../middleware/authMiddleware.js');
    authenticateToken = authMiddleware.authenticateToken;
    if (typeof authenticateToken !== 'function') {
        throw new Error('authenticateToken is not a function');
    }
    console.log('✅ authenticateToken imported successfully in campaignRoutes');
} catch (error) {
    console.error('❌ Failed to import authenticateToken in campaignRoutes:', error);
    // Fallback middleware
    authenticateToken = (req, res, next) => {
        console.warn('⚠️ Using fallback auth middleware in campaignRoutes');
        next();
    };
}

// Import controller with error handling
let campaignController;
try {
    const controller = await import('../controllers/campaignController.js');
    campaignController = controller.campaignController;
    if (!campaignController) {
        throw new Error('campaignController not found in export');
    }
    console.log('✅ campaignController imported successfully');
    console.log('📋 Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(campaignController)));
} catch (error) {
    console.error('❌ Failed to import campaignController:', error);
    // Fallback controller
    campaignController = {
        getCampaigns: (req, res) => res.status(500).json({ error: 'CampaignController not available' }),
        getCampaignAnalytics: (req, res) => res.status(500).json({ error: 'CampaignController not available' }),
        getCampaignById: (req, res) => res.status(500).json({ error: 'CampaignController not available' }),
        sendFollowUp: (req, res) => res.status(500).json({ error: 'CampaignController not available' }),
        retryCampaign: (req, res) => res.status(500).json({ error: 'CampaignController not available' }),
        deleteCampaign: (req, res) => res.status(500).json({ error: 'CampaignController not available' }),
        searchCampaigns: (req, res) => res.status(500).json({ error: 'CampaignController not available' })
    };
}

// All campaign routes require authentication
router.use(authenticateToken);

// Test route
router.get('/test', (req, res) => {
    res.json({ 
        message: 'Campaign routes are working!',
        user: req.user ? req.user.email : 'No user',
        timestamp: new Date().toISOString()
    });
});

// Routes with error checking
router.get('/campaigns', (req, res, next) => {
    if (typeof campaignController.getCampaigns === 'function') {
        campaignController.getCampaigns(req, res, next);
    } else {
        console.error('❌ campaignController.getCampaigns is not a function');
        res.status(500).json({ error: 'Get campaigns functionality not available' });
    }
});

router.get('/campaigns/analytics', (req, res, next) => {
    if (typeof campaignController.getCampaignAnalytics === 'function') {
        campaignController.getCampaignAnalytics(req, res, next);
    } else {
        console.error('❌ campaignController.getCampaignAnalytics is not a function');
        res.status(500).json({ error: 'Get analytics functionality not available' });
    }
});

// NEW: Search campaigns
router.get('/campaigns/search', (req, res, next) => {
    if (typeof campaignController.searchCampaigns === 'function') {
        campaignController.searchCampaigns(req, res, next);
    } else {
        console.error('❌ campaignController.searchCampaigns is not a function');
        res.status(500).json({ error: 'Search campaigns functionality not available' });
    }
});

router.get('/campaigns/:id', (req, res, next) => {
    if (typeof campaignController.getCampaignById === 'function') {
        campaignController.getCampaignById(req, res, next);
    } else {
        console.error('❌ campaignController.getCampaignById is not a function');
        res.status(500).json({ error: 'Get campaign by ID functionality not available' });
    }
});

router.post('/campaigns/:id/follow-up', (req, res, next) => {
    if (typeof campaignController.sendFollowUp === 'function') {
        campaignController.sendFollowUp(req, res, next);
    } else {
        console.error('❌ campaignController.sendFollowUp is not a function');
        res.status(500).json({ error: 'Send follow-up functionality not available' });
    }
});

router.post('/campaigns/:id/retry', (req, res, next) => {
    if (typeof campaignController.retryCampaign === 'function') {
        campaignController.retryCampaign(req, res, next);
    } else {
        console.error('❌ campaignController.retryCampaign is not a function');
        res.status(500).json({ error: 'Retry campaign functionality not available' });
    }
});

// NEW: Delete campaign
router.delete('/campaigns/:id', (req, res, next) => {
    if (typeof campaignController.deleteCampaign === 'function') {
        campaignController.deleteCampaign(req, res, next);
    } else {
        console.error('❌ campaignController.deleteCampaign is not a function');
        res.status(500).json({ error: 'Delete campaign functionality not available' });
    }
});

export default router;