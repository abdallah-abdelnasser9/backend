// middleware/authMiddleware.js
const User = require('../models/User');

// Regular isAuthenticated middleware
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        req.user = req.session.user;
        return next();
    }
    req.flash('error', 'Please login first');
    res.redirect('/login');
};

// Admin middleware - checks if user is admin
exports.isAdmin = async (req, res, next) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login first');
            return res.redirect('/login');
        }
        
        const user = await User.findById(req.session.user.id);
        
        if (!user) {
            req.flash('error', 'User not found');
            req.session.destroy();
            return res.redirect('/login');
        }
        
        if (user.role !== 'admin') {
            req.flash('error', 'Access denied. Admin only.');
            return res.redirect('/');
        }
        
        // Attach user to request for all routes to use
        req.user = user;
        res.locals.user = user; // Make available to all views
        
        next();
    } catch (error) {
        console.error('Admin middleware error:', error);
        req.flash('error', 'An error occurred');
        res.redirect('/');
    }
};
// middleware/authMiddleware.js - UPDATE the setUserData function
exports.setUserData = async (req, res, next) => {
    try {
        // ALWAYS set user to prevent "user is not defined" errors
        res.locals.user = null;
        
        if (req.session && req.session.user) {
            const user = await User.findById(req.session.user.id);
            if (user) {
                res.locals.user = user; // Available in all views
                req.user = user; // Available in routes
            }
        }
        next();
    } catch (error) {
        console.error('setUserData middleware error:', error);
        res.locals.user = null; // Ensure user is always set
        next();
    }
};

// Optional: Combined middleware for authenticated users
exports.requireAuth = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }
    next();
};

// Optional: Check if user is logged in (for navbar etc.)
exports.checkAuth = (req, res, next) => {
    res.locals.isAuthenticated = !!req.session.user;
    if (req.session.user) {
        res.locals.currentUser = req.session.user;
    }
    next();
};