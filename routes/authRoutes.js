import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authenticateToken, sendTokenToFrontend, tokenTest } from '../middleware/authMiddleware.js';
import { authService } from '../services/authService.js';
import { emailService } from '../services/emailService.js';

const router = express.Router();

// Get frontend URL from environment variable with fallback
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';

console.log('🌐 Auth routes configured with FRONTEND_URL:', FRONTEND_URL);

// Google OAuth routes
router.get('/google', (req, res, next) => {
    console.log('🔐 Starting Google OAuth flow...');
    console.log('🌐 Will redirect to:', FRONTEND_URL);
    
    passport.authenticate('google', { 
        scope: ['profile', 'email'],
        prompt: 'select_account'
    })(req, res, next);
});

// Enhanced Google OAuth callback with dynamic frontend URL
router.get('/google/callback', (req, res, next) => {
    console.log('📥 Received Google OAuth callback');
    console.log('🌐 Frontend URL from env:', FRONTEND_URL);
    
    passport.authenticate('google', { session: false }, async (err, user, info) => {
        try {
            if (err) {
                console.error('❌ OAuth error:', err);
                return res.redirect(`${FRONTEND_URL}/login?error=oauth_error`);
            }
            
            if (!user) {
                console.error('❌ No user returned from OAuth:', info);
                return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
            }
            
            console.log('✅ OAuth successful for user:', user.email);
            
            // Generate JWT token
            const token = jwt.sign(
                { 
                    user_id: user.user_id,
                    email: user.email 
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            console.log('🔑 JWT token generated successfully');
            
            // Use the helper function to send token to frontend
            return sendTokenToFrontend(res, req, token, '/');
            
        } catch (error) {
            console.error('❌ OAuth callback error:', error);
            res.redirect(`${FRONTEND_URL}/login?error=server_error`);
        }
    })(req, res, next);
});

// Enhanced auth status check with better debugging
router.get('/status', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 Auth status check for user:', req.user.email);
        console.log('🌐 Request origin:', req.headers.origin);
        
        const userInfo = {
            authenticated: true,
            user: {
                id: req.user.user_id,
                email: req.user.email,
                fullName: req.user.full_name,
                profilePicture: req.user.profile_picture,
                createdAt: req.user.created_at,
                lastLogin: req.user.last_login,
                hasEmailCredentials: req.user.has_email_credentials,
                hasGeminiApiKey: req.user.has_gemini_api_key
            },
            frontendUrl: FRONTEND_URL,
            serverTime: new Date().toISOString()
        };
        
        console.log('✅ Auth status check successful for:', req.user.email);
        res.json(userInfo);
    } catch (error) {
        console.error('❌ Auth status error:', error);
        res.status(500).json({ 
            authenticated: false, 
            error: 'Failed to get auth status',
            frontendUrl: FRONTEND_URL
        });
    }
});

// Token accessibility test endpoint
router.get('/token-test', authenticateToken, tokenTest);

// Test email credentials
router.post('/test-email-credentials', authenticateToken, async (req, res) => {
    try {
        const { emailPassword } = req.body;
        
        if (!emailPassword) {
            return res.status(400).json({ 
                error: 'Email password is required' 
            });
        }
        
        const isValid = await emailService.testEmailCredentials(req.user.email, emailPassword);
        
        if (isValid) {
            res.json({ 
                success: true, 
                message: 'Email credentials are valid' 
            });
        } else {
            res.status(400).json({ 
                error: 'Invalid email credentials' 
            });
        }
        
    } catch (error) {
        console.error('Test email credentials error:', error);
        
        if (error.message && error.message.includes('Invalid login')) {
            return res.status(400).json({ 
                error: 'Gmail app password is incorrect. Please check your app password.',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        if (error.message && error.message.includes('Username and Password not accepted')) {
            return res.status(400).json({ 
                error: 'Gmail app password is incorrect. Please generate a new one.',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to test email credentials',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Save email credentials
router.post('/save-email-credentials', authenticateToken, async (req, res) => {
    try {
        const { emailPassword } = req.body;
        
        if (!emailPassword) {
            return res.status(400).json({ 
                error: 'Email password is required' 
            });
        }
        
        const result = await authService.saveEmailCredentials(req.user.user_id, emailPassword);
        
        res.json({ 
            success: true, 
            hasEmailCredentials: result.has_email_credentials,
            message: 'Email credentials saved successfully' 
        });
        
    } catch (error) {
        console.error('Save email credentials error:', error);
        res.status(500).json({ 
            error: 'Failed to save email credentials',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Test Gemini API credentials
router.post('/test-gemini-credentials', authenticateToken, async (req, res) => {
    try {
        const { geminiApiKey } = req.body;
        
        if (!geminiApiKey) {
            return res.status(400).json({ 
                error: 'Gemini API key is required' 
            });
        }
        
        try {
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            
            const result = await model.generateContent('Test message. Please respond with "API key is working"');
            const response = await result.response;
            const text = response.text();
            
            if (text && text.length > 0) {
                res.json({ 
                    success: true, 
                    message: 'Gemini API key is valid',
                    testResponse: text
                });
            } else {
                res.status(400).json({ 
                    error: 'Invalid Gemini API key - no response received' 
                });
            }
            
        } catch (apiError) {
            console.error('Gemini API test error:', apiError);
            
            if (apiError.message && apiError.message.includes('API_KEY_INVALID')) {
                return res.status(400).json({ 
                    error: 'Invalid Gemini API key. Please check your API key.',
                    code: 'INVALID_API_KEY'
                });
            }
            
            if (apiError.message && apiError.message.includes('quota')) {
                return res.status(400).json({ 
                    error: 'Gemini API quota exceeded. Please check your billing.',
                    code: 'QUOTA_EXCEEDED'
                });
            }
            
            return res.status(400).json({ 
                error: 'Failed to validate Gemini API key',
                details: process.env.NODE_ENV === 'development' ? apiError.message : undefined
            });
        }
        
    } catch (error) {
        console.error('Test Gemini credentials error:', error);
        res.status(500).json({ 
            error: 'Failed to test Gemini credentials',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Save Gemini API credentials
router.post('/save-gemini-credentials', authenticateToken, async (req, res) => {
    try {
        const { geminiApiKey } = req.body;
        
        if (!geminiApiKey) {
            return res.status(400).json({ 
                error: 'Gemini API key is required' 
            });
        }
        
        const result = await authService.saveGeminiCredentials(req.user.user_id, geminiApiKey);
        
        res.json({ 
            success: true, 
            hasGeminiApiKey: result.has_gemini_api_key,
            message: 'Gemini API key saved successfully' 
        });
        
    } catch (error) {
        console.error('Save Gemini credentials error:', error);
        res.status(500).json({ 
            error: 'Failed to save Gemini credentials',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const userInfo = {
            user: {
                id: req.user.user_id,
                email: req.user.email,
                fullName: req.user.full_name,
                profilePicture: req.user.profile_picture,
                createdAt: req.user.created_at,
                lastLogin: req.user.last_login,
                hasEmailCredentials: req.user.has_email_credentials,
                hasGeminiApiKey: req.user.has_gemini_api_key
            },
            stats: await authService.getUserStats(req.user.user_id),
            frontendUrl: FRONTEND_URL
        };
        
        res.json(userInfo);
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// Enhanced logout with proper cookie clearing
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        await authService.logout(req.user.user_id);
        
        // Clear cookies with same options as when they were set
        const cookieOptions = {
            httpOnly: true,
            secure: false,
            sameSite: 'none',
            path: '/'
        };
        
        // Set domain if in production
        if (process.env.NODE_ENV === 'production' && req.headers.origin) {
            try {
                const url = new URL(req.headers.origin);
                if (url.hostname.includes('jwelease.com')) {
                    cookieOptions.domain = '.jwelease.com';
                }
            } catch (error) {
                console.warn('Could not parse origin for logout:', req.headers.origin);
            }
        }
        
        res.clearCookie('token', cookieOptions);
        res.clearCookie('auth_token', cookieOptions);
        res.clearCookie('connect.sid', cookieOptions);
        
        console.log('👋 User logged out successfully');
        res.json({ 
            success: true, 
            message: 'Logged out successfully',
            frontendUrl: FRONTEND_URL
        });
        
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

// Get credentials status
router.get('/credentials-status', authenticateToken, async (req, res) => {
    try {
        const { userRepository } = await import('../repositories/userRepository.js');
        const user = await userRepository.findById(req.user.user_id);
        
        res.json({
            hasEmailCredentials: user.has_email_credentials,
            hasGeminiApiKey: user.has_gemini_api_key,
            email: user.email,
            canSendEmails: user.has_email_credentials,
            canUseAI: user.has_gemini_api_key,
            isFullySetup: user.has_email_credentials && user.has_gemini_api_key,
            frontendUrl: FRONTEND_URL
        });
    } catch (error) {
        console.error('Credentials status check error:', error);
        res.status(500).json({ error: 'Failed to check credentials status' });
    }
});

// Remove email credentials
router.delete('/email-credentials', authenticateToken, async (req, res) => {
    try {
        const result = await authService.removeEmailCredentials(req.user.user_id);
        
        res.json({ 
            success: true, 
            hasEmailCredentials: result.has_email_credentials,
            message: 'Email credentials removed successfully' 
        });
        
    } catch (error) {
        console.error('Remove email credentials error:', error);
        res.status(500).json({ 
            error: 'Failed to remove email credentials',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Remove Gemini API credentials
router.delete('/gemini-credentials', authenticateToken, async (req, res) => {
    try {
        const result = await authService.removeGeminiCredentials(req.user.user_id);
        
        res.json({ 
            success: true, 
            hasGeminiApiKey: result.has_gemini_api_key,
            message: 'Gemini API key removed successfully' 
        });
        
    } catch (error) {
        console.error('Remove Gemini credentials error:', error);
        res.status(500).json({ 
            error: 'Failed to remove Gemini credentials',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Delete account
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const result = await authService.deleteAccount(req.user.user_id);
        
        if (result.success) {
            // Clear cookies
            const cookieOptions = {
                httpOnly: true,
                secure: false,
                sameSite: 'none',
                path: '/'
            };
            
            res.clearCookie('token', cookieOptions);
            res.clearCookie('auth_token', cookieOptions);
            res.clearCookie('connect.sid', cookieOptions);
            
            console.log('🗑️ Account deleted successfully for user:', req.user.email);
            res.json({ 
                success: true, 
                message: 'Account deleted successfully',
                frontendUrl: FRONTEND_URL
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to delete account',
                details: result.error
            });
        }
        
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ 
            error: 'Failed to delete account',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Debug endpoint to check environment configuration
router.get('/debug/config', (req, res) => {
    res.json({
        frontendUrl: FRONTEND_URL,
        nodeEnv: process.env.NODE_ENV,
        origin: req.headers.origin,
        referer: req.headers.referer,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString()
    });
});

export default router;