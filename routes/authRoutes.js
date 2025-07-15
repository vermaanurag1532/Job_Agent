import express from 'express';
import passport from '../config/passport.js';
import { authService } from '../services/authService.js';
import { authenticateToken, rateLimit } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply rate limiting to auth routes
router.use(rateLimit(15 * 60 * 1000, 50)); // 50 requests per 15 minutes

// Simple Google OAuth Routes (just for basic profile)
router.get('/google', 
    passport.authenticate('google', { 
        scope: ['profile', 'email']
    })
);

router.get('/google/callback',
    passport.authenticate('google', { 
        failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/login?error=auth_failed`
    }),
    async (req, res) => {
        try {
            console.log('🔍 Auth callback - req.user:', req.user);
            
            if (!req.user) {
                throw new Error('No user data received from Google');
            }

            const token = authService.generateToken(req.user);
            
            console.log('✅ Token generated for user:', {
                userId: req.user.user_id,
                email: req.user.email,
                tokenGenerated: !!token
            });
            
            // Set token in HTTP-only cookie
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 daysf
            });

            // Redirect to frontend
            const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/?auth=success`;
            console.log('🔄 Redirecting to:', redirectUrl);
            res.redirect(redirectUrl);
        } catch (error) {
            console.error('Google callback error:', error);
            const errorUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/login?error=callback_failed&message=${encodeURIComponent(error.message)}`;
            res.redirect(errorUrl);
        }
    }
);

// Store user's email credentials
router.post('/email-credentials', authenticateToken, async (req, res) => {
    try {
        const { emailPassword } = req.body;
        
        if (!emailPassword) {
            return res.status(400).json({ error: 'Email app password is required' });
        }

        const { userRepository } = await import('../repositories/userRepository.js');
        await userRepository.updateEmailCredentials(req.user.user_id, emailPassword);
        
        res.json({ 
            success: true,
            message: 'Email credentials saved successfully',
            hasEmailCredentials: true
        });
    } catch (error) {
        console.error('Store email credentials error:', error);
        res.status(500).json({ error: 'Failed to store email credentials' });
    }
});

// Remove user's email credentials
router.delete('/email-credentials', authenticateToken, async (req, res) => {
    try {
        const { userRepository } = await import('../repositories/userRepository.js');
        await userRepository.removeEmailCredentials(req.user.user_id);
        
        res.json({ 
            success: true,
            message: 'Email credentials removed successfully',
            hasEmailCredentials: false
        });
    } catch (error) {
        console.error('Remove email credentials error:', error);
        res.status(500).json({ error: 'Failed to remove email credentials' });
    }
});

// Test user's email credentials
router.post('/test-email-credentials', authenticateToken, async (req, res) => {
    try {
        const { emailPassword } = req.body;
        
        if (!emailPassword) {
            return res.status(400).json({ error: 'Email app password is required' });
        }

        console.log(`🧪 Testing email credentials for user: ${req.user.email}`);
        
        // Import email service dynamically
        const { emailService } = await import('../services/emailService.js');
        
        // Create a test transporter
        const testTransporter = emailService.createUserEmailTransporter(req.user.email, emailPassword);
        
        // Test the connection
        await testTransporter.verify();
        
        console.log(`✅ Email credentials test successful for: ${req.user.email}`);
        
        res.json({ 
            success: true,
            message: 'Email credentials are valid',
            email: req.user.email
        });
    } catch (error) {
        console.error('❌ Test email credentials error:', error);
        
        if (error.code === 'EAUTH') {
            return res.status(400).json({ 
                error: 'Invalid email credentials. Please check your app password.',
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
                hasEmailCredentials: req.user.has_email_credentials
            },
            stats: await authService.getUserStats(req.user.user_id)
        };
        
        res.json(userInfo);
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// Get email credentials status
router.get('/email-status', authenticateToken, async (req, res) => {
    try {
        const { userRepository } = await import('../repositories/userRepository.js');
        const user = await userRepository.findById(req.user.user_id);
        
        res.json({
            hasEmailCredentials: user.has_email_credentials,
            email: user.email,
            canSendEmails: user.has_email_credentials
        });
    } catch (error) {
        console.error('Email status check error:', error);
        res.status(500).json({ error: 'Failed to check email status' });
    }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        await authService.logout(req.user.user_id);
        
        // Clear the auth token cookie
        res.clearCookie('auth_token');
        
        // Logout from Passport session
        req.logout((err) => {
            if (err) {
                console.error('Passport logout error:', err);
            }
        });

        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

// Refresh token
router.post('/refresh', async (req, res) => {
    try {
        const oldToken = req.cookies.auth_token || req.body.token;
        
        if (!oldToken) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const result = await authService.refreshToken(oldToken);
        
        // Set new token in cookie
        res.cookie('auth_token', result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        res.json({ 
            success: true, 
            token: result.token 
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(401).json({ error: 'Failed to refresh token' });
    }
});

// Check authentication status
router.get('/status', async (req, res) => {
    try {
        const token = req.cookies.auth_token || req.headers.authorization?.split(' ')[1];
        if (!token) {
            console.log("ANuragVerma")
            return res.json({ authenticated: false });
        }

        const decoded = authService.verifyToken(token);
        
        const { userRepository } = await import('../repositories/userRepository.js');
        const user = await userRepository.findById(decoded.userId);
        console.log(user);
        
        if (!user) {
            return res.json({ authenticated: false });
        }
        
        res.json({ 
            authenticated: true,
            user: {
                id: user.user_id,
                email: user.email,
                name: user.full_name,
                picture: user.profile_picture,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                hasEmailCredentials: user.has_email_credentials
            }
        });
    } catch (error) {
        console.error('❌ Status check error:', error);
        return res.json({ authenticated: false });
    }
});

// Delete account (soft delete)
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const { userRepository } = await import('../repositories/userRepository.js');
        await userRepository.deactivateUser(req.user.user_id);
        
        res.clearCookie('auth_token');
        res.json({ 
            success: true, 
            message: 'Account deactivated successfully' 
        });
    } catch (error) {
        console.error('Account deletion error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// Export as default
export default router;