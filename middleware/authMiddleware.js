import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories/userRepository.js';
import dotenv from 'dotenv';

dotenv.config();

// Get FRONTEND_URL from environment variables
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const allowedOrigins = [
    FRONTEND_URL,                    // Primary frontend URL from .env
    'http://localhost:3001',         // Development fallback
    'http://localhost:3000',         // Same origin
    'https://jwelease.com',          // Production
    'https://www.jwelease.com'       // Production with www
];

console.log('🌐 Configured FRONTEND_URL:', FRONTEND_URL);
console.log('🌐 Allowed origins:', allowedOrigins);

// Enhanced JWT Authentication Middleware
export const authenticateToken = async (req, res, next) => {
    try {
        let token = null;
        
        console.log('🔍 Auth check - Origin:', req.headers.origin);
        console.log('🔍 Auth check - Available cookies:', Object.keys(req.cookies || {}));
        
        // 1. Check Authorization header (Bearer token)
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
            console.log('🔑 Token found in Authorization header');
        }
        
        // 2. Check cookies (for browser requests)
        if (!token && req.cookies) {
            token = req.cookies.token || req.cookies.auth_token || req.cookies['connect.sid'];
            if (token) {
                console.log('🔑 Token found in cookies:', Object.keys(req.cookies));
            }
        }
        
        // 3. Check query parameter (fallback for OAuth redirect)
        if (!token && req.query.token) {
            token = req.query.token;
            console.log('🔑 Token found in query params');
        }

        // 4. Check request body (for some frontend implementations)
        if (!token && req.body && req.body.token) {
            token = req.body.token;
            console.log('🔑 Token found in request body');
        }

        if (!token) {
            console.log('❌ No token found in request');
            console.log('🔍 Debug info:', {
                hasAuthHeader: !!req.headers['authorization'],
                hasCookies: !!req.cookies,
                cookieNames: req.cookies ? Object.keys(req.cookies) : [],
                hasQueryToken: !!req.query.token,
                origin: req.headers.origin,
                referer: req.headers.referer
            });
            
            return res.status(401).json({ 
                error: 'Access denied. No token provided.',
                code: 'NO_TOKEN'
            });
        }

        console.log('🔍 Verifying token...');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('✅ Token decoded:', { user_id: decoded.user_id, email: decoded.email });
        
        const user = await userRepository.findById(decoded.user_id);

        if (!user) {
            console.log('❌ User not found for token');
            return res.status(401).json({ 
                error: 'Invalid token. User not found.',
                code: 'USER_NOT_FOUND'
            });
        }

        if (!user.is_active) {
            console.log('❌ User account deactivated');
            return res.status(401).json({ 
                error: 'User account is deactivated.',
                code: 'USER_DEACTIVATED'
            });
        }

        console.log('✅ User authenticated:', user.email);
        
        req.user = user;
        req.token = token;
        next();
        
    } catch (error) {
        console.log('❌ Token verification failed:', error.message);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                error: 'Invalid token.',
                code: 'INVALID_TOKEN'
            });
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Token expired.',
                code: 'TOKEN_EXPIRED'
            });
        } else {
            console.error('Auth middleware error:', error);
            return res.status(500).json({ 
                error: 'Internal server error.',
                code: 'INTERNAL_ERROR'
            });
        }
    }
};

// Optional authentication - doesn't fail if no token
export const optionalAuth = async (req, res, next) => {
    try {
        let token = null;
        
        // Try multiple token sources
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.cookies) {
            token = req.cookies.token || req.cookies.auth_token || req.cookies['connect.sid'];
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await userRepository.findById(decoded.user_id);
            
            if (user && user.is_active) {
                req.user = user;
                req.token = token;
            }
        }

        next();
    } catch (error) {
        // Continue without authentication on any error
        next();
    }
};

// Dynamic CORS handler that uses FRONTEND_URL from .env
export const handleCORS = (req, res, next) => {
    const origin = req.headers.origin;
    
    console.log('🌐 CORS check - Request origin:', origin);
    console.log('🌐 CORS check - Allowed origins:', allowedOrigins);
    
    // Check if the origin is in our allowed list
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        console.log('✅ CORS allowed for origin:', origin);
    } else if (!origin) {
        // Allow requests without origin (like Postman, curl, same-origin)
        res.header('Access-Control-Allow-Origin', FRONTEND_URL);
        console.log('✅ CORS allowed for no-origin request, using FRONTEND_URL');
    } else {
        console.log('❌ CORS blocked for origin:', origin);
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        console.log('✅ CORS preflight handled for:', origin);
        return res.status(200).end();
    }
    
    next();
};

// Enhanced cookie options based on environment and origin
export const getCookieOptions = (req) => {
    const origin = req.headers.origin;
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecure = isProduction || (origin && origin.startsWith('https://'));
    
    // Determine if we're dealing with cross-origin request
    const isCrossOrigin = origin && !origin.includes('localhost') && origin !== FRONTEND_URL;
    
    const cookieOptions = {
        httpOnly: true,
        secure: isSecure,
        sameSite: isCrossOrigin ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/'
    };
    
    // Set domain for production
    if (isProduction && origin) {
        try {
            const url = new URL(origin);
            const hostname = url.hostname;
            
            // Set domain for cookie sharing across subdomains
            if (hostname.includes('jwelease.com')) {
                cookieOptions.domain = '.jwelease.com';
            }
        } catch (error) {
            console.warn('Could not parse origin for domain setting:', origin);
        }
    }
    
    console.log('🍪 Cookie options for origin', origin, ':', cookieOptions);
    return cookieOptions;
};

// Helper function to send token to frontend
export const sendTokenToFrontend = (res, req, token, redirectPath = '/dashboard') => {
    const cookieOptions = getCookieOptions(req);
    
    // Set the token in multiple ways for maximum compatibility
    res.cookie('token', token, cookieOptions);
    res.cookie('auth_token', token, cookieOptions);
    
    // For cross-origin or problematic cookie scenarios, also include in URL
    const separator = redirectPath.includes('?') ? '&' : '?';
    const urlWithToken = `${FRONTEND_URL}${redirectPath}${separator}token=${encodeURIComponent(token)}&auth=success`;
    
    console.log('🔄 Redirecting to:', urlWithToken);
    console.log('🍪 Cookies set with options:', cookieOptions);
    
    return res.redirect(urlWithToken);
};

// Test endpoint to verify token accessibility
export const tokenTest = (req, res) => {
    const tokenSources = {
        authHeader: req.headers['authorization'],
        cookies: req.cookies,
        query: req.query.token,
        body: req.body?.token
    };
    
    res.json({
        success: true,
        message: 'Token accessibility test',
        origin: req.headers.origin,
        frontendUrl: FRONTEND_URL,
        tokenSources,
        user: req.user ? { id: req.user.user_id, email: req.user.email } : null
    });
};

// Enhanced rate limiting with user-specific limits
const requestCounts = new Map();
const userRequestCounts = new Map();

export const rateLimit = (windowMs = 15 * 60 * 1000, max = 100, userMax = null) => {
    return (req, res, next) => {
        const now = Date.now();
        const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        
        // IP-based rate limiting
        if (!requestCounts.has(ip)) {
            requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
        } else {
            const record = requestCounts.get(ip);
            
            if (now > record.resetTime) {
                record.count = 1;
                record.resetTime = now + windowMs;
            } else {
                if (record.count >= max) {
                    return res.status(429).json({
                        error: 'Too many requests from this IP. Please try again later.',
                        code: 'RATE_LIMIT_IP',
                        retryAfter: Math.ceil((record.resetTime - now) / 1000)
                    });
                }
                record.count++;
            }
        }

        // User-based rate limiting (if authenticated and userMax is set)
        if (req.user && userMax) {
            const userId = req.user.user_id;
            
            if (!userRequestCounts.has(userId)) {
                userRequestCounts.set(userId, { count: 1, resetTime: now + windowMs });
            } else {
                const userRecord = userRequestCounts.get(userId);
                
                if (now > userRecord.resetTime) {
                    userRecord.count = 1;
                    userRecord.resetTime = now + windowMs;
                } else {
                    if (userRecord.count >= userMax) {
                        return res.status(429).json({
                            error: 'Too many requests for this user. Please try again later.',
                            code: 'RATE_LIMIT_USER',
                            retryAfter: Math.ceil((userRecord.resetTime - now) / 1000)
                        });
                    }
                    userRecord.count++;
                }
            }
        }

        next();
    };
};

// Cleanup old rate limit records periodically
setInterval(() => {
    const now = Date.now();
    
    for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetTime) {
            requestCounts.delete(key);
        }
    }
    
    for (const [key, record] of userRequestCounts.entries()) {
        if (now > record.resetTime) {
            userRequestCounts.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Check if user is authenticated (for session-based auth)
export const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    return res.status(401).json({ 
        error: 'Authentication required.',
        code: 'AUTH_REQUIRED'
    });
};

// Enhanced authorization middleware with role support
export const authorize = (roles = [], permissions = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required.',
                code: 'AUTH_REQUIRED'
            });
        }

        if (!req.user.is_active) {
            return res.status(401).json({ 
                error: 'User account is deactivated.',
                code: 'USER_DEACTIVATED'
            });
        }

        // Future role checking implementation
        if (roles.length > 0) {
            // TODO: Implement role checking when user roles are added
        }

        next();
    };
};

// Middleware to extract user info from various auth methods
export const extractUser = async (req, res, next) => {
    try {
        await optionalAuth(req, res, () => {});
        
        if (!req.user && req.isAuthenticated && req.isAuthenticated()) {
            req.user = req.user || req.session.passport?.user;
        }
        
        next();
    } catch (error) {
        console.error('Error extracting user:', error);
        next();
    }
};

// Security headers middleware
export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    next();
};