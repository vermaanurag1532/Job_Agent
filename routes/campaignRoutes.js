import express from 'express';
import { campaignController } from '../controllers/campaignController.js';

const router = express.Router();

// Routes
router.get('/campaigns', campaignController.getCampaigns);
router.get('/campaigns/:id', campaignController.getCampaignById);
router.post('/campaigns/:id/follow-up', campaignController.sendFollowUp);

export default router;