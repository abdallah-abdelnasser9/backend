const express = require('express');
const router = express.Router();
const User = require('../models/User');

// ============================
// REGISTER PAGE
// ============================
router.get('/register', (req, res) => {
    res.render('auth/register', { 
        title: 'Register',
        formData: null,
        errors: null,
        error: null
    });
});

// ============================
// LOGIN PAGE (GET)
// ============================
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('auth/login', { 
        title: 'Login',
        formData: null,
        error: null
    });
});

// ============================
// LOGIN (POST) - SINGLE ROUTE
// ============================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await User.findOne({ email });
        
        if (!user) {
            return res.render('auth/login', {
                title: 'Login',
                formData: req.body,
                error: 'Invalid email or password'
            });
        }
        
        // Check if user is active
        if (!user.isActive) {
            return res.render('auth/login', {
                title: 'Login',
                formData: req.body,
                error: 'Account is disabled. Please contact support.'
            });
        }
        
        // Check password using the model's method
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.render('auth/login', {
                title: 'Login',
                formData: req.body,
                error: 'Invalid email or password'
            });
        }
        
        // Update last login
        user.lastLogin = new Date();
        user.isOnline = true;
        await user.save();
        
        // Set session
        req.session.user = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role
        };
        
        // Save session
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render('auth/login', {
                    title: 'Login',
                    formData: req.body,
                    error: 'Login failed. Please try again.'
                });
            }
            
            // REDIRECT BASED ON ROLE
            if (user.role === 'admin') {
                req.flash('success', 'Welcome back, Administrator!');
                return res.redirect('/admin/dashboard');
            } else {
                req.flash('success', 'Login successful!');
                return res.redirect('/');
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.render('auth/login', {
            title: 'Login',
            formData: req.body,
            error: 'Something went wrong. Please try again.'
        });
    }
});

// ============================
// REGISTER (POST)
// ============================
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, confirmPassword } = req.body;
        
        // Validation
        const errors = [];
        
        if (!name || name.trim().length < 2) {
            errors.push({ msg: 'Name must be at least 2 characters' });
        }
        
        if (!email || !email.includes('@')) {
            errors.push({ msg: 'Valid email is required' });
        }
        
        if (!password || password.length < 6) {
            errors.push({ msg: 'Password must be at least 6 characters' });
        }
        
        if (password !== confirmPassword) {
            errors.push({ msg: 'Passwords do not match' });
        }
        
        if (errors.length > 0) {
            return res.render('auth/register', {
                title: 'Register',
                formData: req.body,
                errors: errors,
                error: null
            });
        }
        
        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.render('auth/register', {
                title: 'Register',
                formData: req.body,
                errors: null,
                error: 'Email already registered'
            });
        }
        
        // Create user
        const user = new User({
            name,
            email,
            password
        });
        
        await user.save();
        
        // Set session
        req.session.user = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role
        };
        
        // Save session
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render('auth/register', {
                    title: 'Register',
                    formData: req.body,
                    errors: null,
                    error: 'Registration failed. Please try again.'
                });
            }
            
            req.flash('success', 'Registration successful! Welcome to our store.');
            res.redirect('/');
        });
    } catch (error) {
        console.error(error);
        res.render('auth/register', {
            title: 'Register',
            formData: req.body,
            errors: null,
            error: 'Something went wrong. Please try again.'
        });
    }
});

// ============================
// LOGOUT
// ============================
router.get('/logout', async (req, res) => {
    try {
        // Update user status before destroying session
        if (req.session.user) {
            await User.findByIdAndUpdate(req.session.user.id, {
                isOnline: false
            });
        }
        
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
            }
            res.redirect('/');
        });
    } catch (error) {
        console.error('Logout error:', error);
        req.session.destroy();
        res.redirect('/');
    }
});

// ============================
// PROFILE PAGE (GET)
// ============================
router.get('/profile', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login first');
            return res.redirect('/login');
        }
        
        const user = await User.findById(req.session.user.id);
        if (!user) {
            req.session.destroy();
            req.flash('error', 'User not found');
            return res.redirect('/login');
        }
        
        res.render('auth/profile', { 
            title: 'My Profile',
            user 
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Error loading profile');
        res.redirect('/');
    }
});

// ============================
// UPDATE PROFILE (POST)
// ============================
router.post('/profile', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        
        const { name, phone } = req.body;
        
        await User.findByIdAndUpdate(req.session.user.id, {
            name,
            phone
        });
        
        // Update session
        req.session.user.name = name;
        
        // Save session
        req.session.save((err) => {
            if (err) {
                req.flash('error', 'Failed to update profile');
                return res.redirect('/auth/profile');
            }
            
            req.flash('success', 'Profile updated successfully');
            res.redirect('/auth/profile');
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update profile');
        res.redirect('/auth/profile');
    }
});

module.exports = router;