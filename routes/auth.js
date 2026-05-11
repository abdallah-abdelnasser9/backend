const express = require('express');
const router = express.Router();
const User = require('../models/User');


// ============================
// ============================
// REGISTER (API)
// ============================
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, confirmPassword } = req.body;

        // Validation
        if (!name || name.trim().length < 2) {
            return res.status(400).json({ message: 'Name must be at least 2 characters' });
        }

        if (!email || !email.includes('@')) {
            return res.status(400).json({ message: 'Valid email is required' });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'Email already registered' });
        }

        // Create user
        const user = new User({
            name,
            email,
            password
        });

        await user.save();

        req.session.user = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role
        };

        return res.status(201).json({
            message: 'Registration successful',
            user: req.session.user
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});


// ============================
// LOGIN (API)
// ============================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!user.isActive) {
            return res.status(403).json({ message: 'Account is disabled' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        user.lastLogin = new Date();
        user.isOnline = true;
        await user.save();

        req.session.user = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role
        };

        return res.json({
            message: 'Login successful',
            user: req.session.user
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});


// ============================
// LOGOUT (API)
// ============================
router.get('/logout', async (req, res) => {
    try {
        if (req.session.user) {
            await User.findByIdAndUpdate(req.session.user.id, {
                isOnline: false
            });
        }

        req.session.destroy(() => {
            return res.json({ message: 'Logged out successfully' });
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Logout error' });
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