import express from 'express';
import passport from '../config/passport.js';
import { authService } from '../services/authService.js';
import { authenticateToken, rateLimit } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply rate limiting to auth routes
router.use(rateLimit(15 * 60 * 1000, 50)); // 50 requests per 15 minutes

// Google OAuth Routes
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

            // req.user is already the database user object from Passport strategy
            // We just need to generate a token and create the response
            const token = authService.generateToken(req.user);
            
            console.log('✅ Token generated for user:', {
                userId: req.user.user_id,
                email: req.user.email,
                tokenGenerated: !!token
            });
            
            // Set token in HTTP-only cookie (more secure)
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                domain: 'localhost' // Allow cookies across localhost ports
            });

            // Redirect to frontend dashboard with success
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

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        // req.user already contains the user info from authenticateToken middleware
        const userInfo = {
            user: {
                id: req.user.user_id,
                email: req.user.email,
                fullName: req.user.full_name,
                profilePicture: req.user.profile_picture,
                createdAt: req.user.created_at,
                lastLogin: req.user.last_login
            },
            stats: await authService.getUserStats(req.user.user_id)
        };
        
        res.json(userInfo);
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
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
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            domain: 'localhost'
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
// Fixed /auth/status endpoint - Replace this in your backend auth routes

// Check authentication status
router.get('/status', async (req, res) => {
    try {
        console.log('🔍 Auth status check - cookies:', req.cookies);
        console.log('🔍 Auth status check - headers:', req.headers.authorization);
        
        const token = req.cookies.auth_token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            console.log('❌ No token found');
            return res.json({ authenticated: false });
        }

        console.log('🔍 Token found, verifying...');
        const decoded = authService.verifyToken(token);
        console.log('🔍 Token decoded:', { userId: decoded.userId });
        
        const { userRepository } = await import('../repositories/userRepository.js');
        const user = await userRepository.findById(decoded.userId);
        
        if (!user) {
            console.log('❌ User not found in database');
            return res.json({ authenticated: false });
        }
        
        console.log('✅ User authenticated:', { userId: user.user_id, email: user.email });
        
        // 🎯 FIXED: Return the same format as your frontend expects
        res.json({ 
            authenticated: true,
            user: {
                id: user.user_id,
                email: user.email,
                name: user.full_name,  // 🔥 Changed from fullName to name for frontend compatibility
                picture: user.profile_picture,  // 🔥 Changed from profilePicture to picture for frontend compatibility
                createdAt: user.created_at,
                lastLogin: user.last_login
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