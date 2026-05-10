const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const User = require('../models/User'); // Add this import

// ========== MIDDLEWARE ==========
// Enhanced auth middleware
const requireLogin = async (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }
    
    try {
        // Verify user exists in database
        const user = await User.findById(req.session.user.id);
        if (!user || !user.isActive) {
            req.flash('error', 'User account not found or disabled');
            return res.redirect('/login');
        }
        
        // Attach user to request
        req.user = user;
        next();
        
    } catch (error) {
        console.error('Auth error:', error);
        req.flash('error', 'Authentication error');
        res.redirect('/login');
    }
};

// Apply to all user chat routes
router.use(requireLogin);

// ========== ROUTES ==========

// GET /chat - User chat page
router.get('/', async (req, res) => {
    try {
        const userId = req.user._id; // Use req.user from middleware
        
        // Get chat history with admin
        const messages = await Chat.find({
            $or: [
                { sender: userId, receiver: 'admin' },
                { sender: 'admin', receiver: userId }
            ]
        })
        .sort({ createdAt: 1 })
        .limit(100);

        // Mark admin messages as read
        await Chat.updateMany(
            {
                sender: 'admin',
                receiver: userId,
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date()
            }
        );

        res.render('chat/index', {
            layout: 'layouts/main',
            title: 'Chat Support',
            user: req.user, // Use req.user
            messages: messages,
            adminId: 'admin'
        });
        
    } catch (error) {
        console.error('User chat error:', error);
        res.render('chat/index', {
            layout: 'layouts/main',
            title: 'Chat Support',
            user: req.user || {},
            messages: [],
            adminId: 'admin'
        });
    }
});

// POST /chat/send - Send message from user to admin
router.post('/send', async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.session.user.id;
        
        if (!message || !message.trim()) {
            return res.json({ 
                success: false, 
                error: 'Message is required' 
            });
        }
        
        // Create and save chat message
        const chat = new Chat({
            sender: userId,
            receiver: 'admin',
            message: message.trim(),
            isRead: false
        });
        
        await chat.save();
        
        // Get socket instance
        const io = req.app.get('io');
        if (io) {
            // Emit to admin
            io.to('admin').emit('receiveMessage', {
                _id: chat._id,
                sender: userId,
                receiver: 'admin',
                message: message,
                createdAt: chat.createdAt,
                isRead: false
            });
            
            // Also emit to user for confirmation
            io.to(userId).emit('messageSent', {
                messageId: chat._id,
                status: 'delivered'
            });
            
            console.log('📤 User message emitted via socket to admin');
        } else {
            console.error('❌ Socket.io not available');
        }
        
        res.json({ 
            success: true, 
            message: 'Message sent successfully',
            chatId: chat._id 
        });
        
    } catch (error) {
        console.error('Send message error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to send message' 
        });
    }
});

// GET /chat/api/messages - Get messages API
router.get('/api/messages', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const messages = await Chat.find({
            $or: [
                { sender: userId, receiver: 'admin' },
                { sender: 'admin', receiver: userId }
            ]
        })
        .sort({ createdAt: 1 });

        res.json({ success: true, messages });
    } catch (error) {
        console.error('API error:', error);
        res.json({ success: false, error: error.message });
    }
});

// GET /chat/api/unread-count - Get unread count
router.get('/api/unread-count', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const count = await Chat.countDocuments({
            receiver: userId,
            sender: 'admin',
            isRead: false
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error('Unread count error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Add these test routes
router.get('/test-button', (req, res) => {
    res.send(`
        <html>
        <head>
            <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        </head>
        <body>
            <h1>Button Test</h1>
            <button id="testBtn">Test Button</button>
            <div id="result"></div>
            <script>
                $('#testBtn').click(function() {
                    $('#result').html('Button clicked at ' + new Date().toLocaleTimeString());
                    alert('Button works!');
                });
                // Test after 2 seconds
                setTimeout(() => {
                    $('#testBtn').trigger('click');
                }, 2000);
            </script>
        </body>
        </html>
    `);
});

router.post('/test-send', (req, res) => {
    console.log('Test send received:', req.body);
    res.json({ 
        success: true, 
        message: 'Test message received',
        data: req.body 
    });
});
module.exports = router;