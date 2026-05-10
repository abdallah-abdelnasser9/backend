const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); 
const Chat = require('../models/Chat');
const User = require('../models/User');

// ========== MIDDLEWARE ==========
// Admin only middleware
const requireAdmin = async (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }
    
    try {
        const user = await User.findById(req.session.user.id);
        
        if (!user || user.role !== 'admin') {
            req.flash('error', 'Access denied. Admin only.');
            return res.redirect('/');
        }
        
        req.user = user; // Attach user to request
        next();
        
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect('/');
    }
};

// Apply to all admin chat routes
router.use(requireAdmin);

// ========== ROUTES ==========

// GET /admin/chat - Admin chat dashboard
router.get('/', async (req, res) => {
    try {
        // Get all users who have chatted with admin
        const chats = await Chat.find({
            $or: [
                { receiver: 'admin' },
                { sender: 'admin' }
            ]
        })
        .sort({ createdAt: -1 });

        // Group by user
        const userMap = new Map();
        
        for (const chat of chats) {
            let userId;
            
            // Determine user ID (not admin)
            if (chat.sender === 'admin') {
                userId = chat.receiver;
            } else {
                userId = chat.sender;
            }
            
            // Skip admin
            if (userId === 'admin') continue;
            
            // Get user info if not already in map
            if (!userMap.has(userId)) {
                let user = await User.findById(userId).select('name email');
                let userName = user ? user.name : `User ${userId.substring(0, 8)}`;
                let userEmail = user ? user.email : '';
                
                // Get unread count
                const unreadCount = await Chat.countDocuments({
                    sender: userId,
                    receiver: 'admin',
                    isRead: false
                });
                
                userMap.set(userId, {
                    userId: userId,
                    name: userName,
                    email: userEmail,
                    unreadCount: unreadCount,
                    lastMessage: chat.message,
                    lastMessageTime: chat.createdAt
                });
            }
        }

        // Convert to array and sort by last message time
        const users = Array.from(userMap.values())
            .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

        res.render('admin/chat/index', {
            layout: 'layouts/admin-layout',
            title: 'Admin Chat Dashboard',
            currentPage: 'chat',
            user: req.user,
            users: users
        });
        
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.render('admin/chat/index', {
            layout: 'layouts/admin-layout',
            title: 'Admin Chat Dashboard',
            currentPage: 'chat',
            user: req.user,
            users: []
        });
    }
});

// GET /admin/chat/:userId - Chat with specific user
router.get('/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        // Get user info
        let user = await User.findById(userId).select('name email');
        if (!user) {
            user = {
                _id: userId,
                name: `User ${userId.substring(0, 8)}`,
                email: 'unknown@example.com'
            };
        }

        // Get chat history
        const messages = await Chat.find({
            $or: [
                { sender: userId, receiver: 'admin' },
                { sender: 'admin', receiver: userId }
            ]
        })
        .sort({ createdAt: 1 });

        // Mark user messages as read
        await Chat.updateMany(
            {
                sender: userId,
                receiver: 'admin',
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date()
            }
        );

        res.render('admin/chat/conversation', {
            layout: 'layouts/admin-layout',
            title: `Chat with ${user.name}`,
            currentPage: 'chat',
            user: req.user,
            chatUser: user,
            messages: messages,
            adminId: 'admin'
        });
        
    } catch (error) {
        console.error('Chat conversation error:', error);
        req.flash('error', 'Error loading chat');
        res.redirect('/admin/chat');
    }
});

// POST /admin/chat/send - Send message from admin to user
// POST /admin/chat/send - Send message from admin to user
router.post('/send', async (req, res) => {
    try {
        const { receiverId, message } = req.body;
        
        if (!receiverId || !message) {
            return res.json({ 
                success: false, 
                error: 'Receiver ID and message are required' 
            });
        }
        
        // Create and save chat message
        const chat = new Chat({
            sender: 'admin',
            receiver: receiverId,
            message: message.trim(),
            isRead: false
        });
        
        await chat.save();
        
        // Get socket instance
        const io = req.app.get('io');
        if (io) {
            // Emit to the user's room
            io.to(receiverId).emit('receiveMessage', {
                _id: chat._id,
                sender: 'admin',
                receiver: receiverId,
                message: message,
                createdAt: chat.createdAt,
                isRead: false
            });
            
            // Also emit to admin room for UI updates
            io.to('admin').emit('messageSent', {
                messageId: chat._id,
                status: 'delivered',
                receiverId: receiverId
            });
            
            console.log('📤 Admin message emitted via socket to:', receiverId);
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
// GET /admin/chat/api/unread-count - Get admin unread count
router.get('/api/unread-count', async (req, res) => {
    try {
        const count = await Chat.countDocuments({
            receiver: 'admin',
            isRead: false,
            sender: { $ne: 'admin' }
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error('Unread count error:', error);
        res.json({ success: false, error: error.message });
    }
});

// GET /admin/chat/api/messages/:userId - Get messages API
router.get('/api/messages/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
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

module.exports = router;