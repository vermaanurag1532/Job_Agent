import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories/userRepository.js';
import dotenv from 'dotenv';

dotenv.config();

// JWT Authentication Middleware - Enhanced for cookie + header support
export const authenticateToken = async (req, res, next) => {
    try {
        // Try to get token from multiple sources
        let token = null;
        
        // 1. Check Authorization header (Bearer token)
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        
        // 2. Check cookies (for browser requests)
        if (!token && req.cookies && req.cookies.auth_token) {
            token = req.cookies.auth_token;
        }
        
        // 3. Check query parameter (fallback, less secure)
        if (!token && req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ 
                error: 'Access denied. No token provided.',
                code: 'NO_TOKEN'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await userRepository.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({ 
                error: 'Invalid token. User not found.',
                code: 'USER_NOT_FOUND'
            });
        }

        // Check if user is still active
        if (!user.is_active) {
            return res.status(401).json({ 
                error: 'User account is deactivated.',
                code: 'USER_DEACTIVATED'
            });
        }

        // Add user to request object
        req.user = user;
        req.token = token; // Store token for potential refresh
        next();
    } catch (error) {
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
        } else if (req.cookies && req.cookies.auth_token) {
            token = req.cookies.auth_token;
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await userRepository.findById(decoded.userId);
            
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

        // Check if user is active
        if (!req.user.is_active) {
            return res.status(401).json({ 
                error: 'User account is deactivated.',
                code: 'USER_DEACTIVATED'
            });
        }

        // For now, all authenticated users have access
        // Future implementation can check roles and permissions
        if (roles.length > 0) {
            // TODO: Implement role checking when user roles are added
            // const userRoles = req.user.roles || [];
            // const hasRole = roles.some(role => userRoles.includes(role));
            // if (!hasRole) {
            //     return res.status(403).json({ 
            //         error: 'Insufficient permissions.',
            //         code: 'INSUFFICIENT_PERMISSIONS'
            //     });
            // }
        }

        next();
    };
};

// Enhanced rate limiting with user-specific limits
const requestCounts = new Map();
const userRequestCounts = new Map();

export const rateLimit = (windowMs = 15 * 60 * 1000, max = 100, userMax = null) => {
    return (req, res, next) => {
        const now = Date.now();
        
        // IP-based rate limiting
        const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        
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
    
    // Clean IP-based records
    for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetTime) {
            requestCounts.delete(key);
        }
    }
    
    // Clean user-based records
    for (const [key, record] of userRequestCounts.entries()) {
        if (now > record.resetTime) {
            userRequestCounts.delete(key);
        }
    }
}, 5 * 60 * 1000); // Clean every 5 minutes

// Middleware to handle CORS preflight requests
export const handleCORS = (req, res, next) => {
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        // res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:3001');
        res.header('Access-Control-Allow-Origin', 'https://job-agent-front-end.vercel.app/');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
        return res.status(200).end();
    }
    next();
};

// Middleware to extract user info from various auth methods
export const extractUser = async (req, res, next) => {
    try {
        // First try JWT token
        await optionalAuth(req, res, () => {});
        
        // If no JWT user, try session
        if (!req.user && req.isAuthenticated && req.isAuthenticated()) {
            req.user = req.user || req.session.passport?.user;
        }
        
        next();
    } catch (error) {
        console.error('Error extracting user:', error);
        next(); // Continue without user
    }
};

// Security headers middleware
export const securityHeaders = (req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Only set HSTS in production with HTTPS
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    next();
};