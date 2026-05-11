require('dotenv').config();
const express = require('express'); 
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const flash = require('connect-flash');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const adminApiRoutes = require('./routes/admin-api');

const app = express();
const server = http.createServer(app);
// In server.js, add these imports:
console.log(process.env.MONGO_URI);
// Database connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.log('MongoDB connection error:', err));

// Add CORS middleware (BEFORE other middleware)
app.use(cors({
  origin: [
    'http://localhost:4200',
    'https://e-commerce-4o3t.vercel.app'
  ],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(flash());

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: true,
    saveUninitialized: true,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/noon-ecommerce',
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60,
        autoRemove: 'native'
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// EJS setup with express-ejs-layouts
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

app.use('/api', apiRoutes);
// ========== IMPORT AUTH MIDDLEWARE ==========
const { setUserData, checkAuth } = require('./middleware/authMiddleware');
app.use('/admin', (req, res, next) => {
    // For all admin routes, change the default layout
    res.locals.layout = 'layouts/admin-layout';
    next();
});
app.use('/api/admin', adminApiRoutes);


// ========== GLOBAL MIDDLEWARE ==========
// IMPORTANT: Use setUserData BEFORE checkAuth
app.use(setUserData);  // Makes user available in all views via res.locals.user
app.use(checkAuth);    // Sets isAuthenticated flag
app.use('/admin', (req, res, next) => {
    // For all admin routes, change the default layout
    res.locals.layout = 'layouts/admin-layout';
    next();
});
// Additional global variables
app.use((req, res, next) => {
    // These are already set by setUserData middleware
    // Add any additional globals here
    res.locals.cartCount = req.session.cartCount || 0;
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('error');
    next();
});

// Import models
const Product = require('./models/Product');
const Category = require('./models/Category');

// server.js (Socket.io section)
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:4200", "http://localhost:8080"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store connected users and their socket IDs
const userSockets = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId
const userRooms = new Map(); // userId -> rooms

// Admin room constant
const ADMIN_ROOM = 'admin-room';
const ADMIN_ID = 'admin';

// Add heartbeat/ping-pong for connection keep-alive
setInterval(() => {
  const now = Date.now();
  io.sockets.sockets.forEach(socket => {
    if (socket.lastPing && (now - socket.lastPing) > 120000) {
      console.log(`🫀 No heartbeat from ${socket.id}, disconnecting`);
      socket.disconnect(true);
    }
  });
}, 30000);

io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);
  socket.lastPing = Date.now();
  
  // Handle ping from client
  socket.on('ping', () => {
    socket.lastPing = Date.now();
    socket.emit('pong');
  });

  // User joins chat
  socket.on('join', (userId) => {
    console.log(`👤 User ${userId} joining chat`);
    
    if (!userId) {
      console.error('❌ No userId provided for join');
      socket.emit('joinError', { error: 'User ID is required' });
      return;
    }
    
    // Clear any existing connection for this user
    const existingSocketId = userSockets.get(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        console.log(`🔄 Closing duplicate connection for ${userId}`);
        existingSocket.emit('forceDisconnect', { reason: 'New connection from same user' });
        existingSocket.disconnect(true);
      }
      userSockets.delete(userId);
      socketUsers.delete(existingSocketId);
    }
    
    // Store new connection
    userSockets.set(userId, socket.id);
    socketUsers.set(socket.id, userId);
    socket.userId = userId;
    
    // Join user's personal room
    const userRoom = `user:${userId}`;
    socket.join(userRoom);
    
    // Store user's rooms
    userRooms.set(userId, [userRoom]);
    
    // If user is admin, join admin room
    if (userId === ADMIN_ID || userId.includes('admin')) {
      socket.join(ADMIN_ROOM);
      if (!userRooms.get(userId)?.includes(ADMIN_ROOM)) {
        userRooms.set(userId, [...(userRooms.get(userId) || []), ADMIN_ROOM]);
      }
      console.log('🛡️ Admin joined admin room');
      
      // Notify all users that admin is online
      io.emit('adminStatus', { isOnline: true });
      
      // Get list of connected users and send to admin
      const connectedUsers = Array.from(userSockets.keys())
        .filter(id => id !== ADMIN_ID && !id.includes('admin'));
      socket.emit('connectedUsers', connectedUsers);
      
      // Also send user activity to admin for each connected user
      connectedUsers.forEach(userId => {
        socket.emit('userActivity', {
          userId: userId,
          action: 'connected',
          timestamp: new Date()
        });
      });
    } else {
      // Regular user joined
      console.log(`👤 Regular user ${userId} joined`);
      
      // Send admin status to this user
      const isAdminOnline = Array.from(userSockets.keys()).some(id => 
        id === ADMIN_ID || id.includes('admin')
      );
      socket.emit('adminStatus', { isOnline: isAdminOnline });
      
      // Notify admin that user connected
      io.to(ADMIN_ROOM).emit('userConnected', {
        userId: userId,
        timestamp: new Date()
      });
      
      // Send user joined event to admin room
      io.to(ADMIN_ROOM).emit('userJoined', {
        userId: userId,
        userCount: Array.from(userSockets.keys()).filter(id => 
          id !== ADMIN_ID && !id.includes('admin')
        ).length
      });
    }
    
    // Send confirmation to user
    socket.emit('joined', { 
      userId: userId, 
      timestamp: new Date(),
      isAdminOnline: userId === ADMIN_ID ? true : Array.from(userSockets.keys()).some(id => 
        id === ADMIN_ID || id.includes('admin')
      )
    });
    
    console.log(`✅ User ${userId} successfully joined. Socket ID: ${socket.id}`);
  });

  // ========== HANDLE SENDING MESSAGES ==========
  // In your socket.io server code, update the sendMessage handler:

socket.on('sendMessage', async (data) => {
  try {
    console.log('📩 Message received:', { 
      senderId: data.senderId, 
      receiverId: data.receiverId,
      message: data.message.substring(0, 50) + '...' 
    });
    
    const { senderId, receiverId, message, messageType = 'text', metadata } = data;
    
    // Validation
    if (!senderId || !receiverId || !message || message.trim() === '') {
      socket.emit('messageError', { error: 'Missing required fields' });
      return;
    }
    
    // Import Chat model
    const Chat = require('./models/Chat');
    
    // Save message to database
    const chat = new Chat({
      sender: senderId,
      receiver: receiverId,
      message: message.trim(),
      messageType: messageType,
      metadata: metadata || {},
      isRead: false,
      readAt: null
    });
    
    await chat.save();
    console.log(`💾 Message saved to DB: ${chat._id}`);
    
    // Prepare message data for real-time
    const messageData = {
      _id: chat._id.toString(),
      sender: senderId,
      receiver: receiverId,
      message: message.trim(),
      messageType: messageType,
      metadata: chat.metadata,
      isRead: false,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      readAt: null
    };
    
    // ========== USER TO ADMIN MESSAGE ==========
    if (senderId !== 'admin' && receiverId === 'admin') {
      console.log(`📤 User ${senderId} → Admin: ${message.substring(0, 50)}...`);
      
      // Send to all admin connections (admin room)
      io.to(ADMIN_ROOM).emit('receiveMessage', messageData);
      
      // Also send to the specific user for confirmation
      socket.emit('messageSent', {
        messageId: chat._id,
        status: 'delivered',
        timestamp: new Date()
      });
      
      // Update unread count for this user in admin panel
      const adminSockets = io.sockets.adapter.rooms.get(ADMIN_ROOM);
      if (adminSockets) {
        adminSockets.forEach(adminSocketId => {
          const adminSocket = io.sockets.sockets.get(adminSocketId);
          if (adminSocket) {
            adminSocket.emit('unreadUpdate', {
              userId: senderId,
              count: 1 // You might want to calculate actual unread count
            });
          }
        });
      }
      
      // Auto-detect product inquiry
      if (isProductInquiry(message) && metadata?.productId) {
        setTimeout(() => {
          handleProductInquiry(senderId, message, metadata);
        }, 500);
      }
    }
    
    // ========== ADMIN TO USER MESSAGE ==========
    else if (senderId === 'admin' && receiverId !== 'admin') {
      console.log(`📤 Admin → User ${receiverId}: ${message.substring(0, 50)}...`);
      
      // Find user's personal room
      const userRoom = `user:${receiverId}`;
      const userSocketId = userSockets.get(receiverId);
      
      if (userSocketId) {
        // Send to specific user's room (user will receive if connected)
        io.to(userRoom).emit('receiveMessage', messageData);
        console.log(`✅ Message sent to user ${receiverId} in room ${userRoom}`);
        
        // Also send confirmation to admin
        socket.emit('messageSent', {
          messageId: chat._id,
          status: 'delivered',
          timestamp: new Date()
        });
      } else {
        console.log(`📤 User ${receiverId} is offline. Message saved for later.`);
        
        // Still send confirmation to admin
        socket.emit('messageSent', {
          messageId: chat._id,
          status: 'saved-offline',
          timestamp: new Date()
        });
      }
      
      // Also send to admin room for other admins to see
      socket.to(ADMIN_ROOM).emit('adminMessageSent', messageData);
    }
    
  } catch (error) {
    console.error('❌ Error sending message:', error);
    socket.emit('messageError', { error: 'Failed to send message', details: error.message });
  }
});

  // ========== PRODUCT INQUIRY HANDLER ==========
  socket.on('productInquiry', async (data) => {
    try {
      console.log('🔍 Product inquiry received:', data);
      
      const { userId, productId, productName, question } = data;
      
      if (!userId || !question) {
        console.error('Missing required fields for product inquiry');
        socket.emit('inquiryError', { error: 'Missing required fields' });
        return;
      }
      
      // Import required models
      const Chat = require('./models/Chat');
      const Product = require('./models/Product');
      
      let product = null;
      if (productId) {
        product = await Product.findById(productId).select('name price stock category');
      }
      
      // Create inquiry message
      const inquiryMessage = `🔍 Product Inquiry: ${product?.name || productName || 'Unknown Product'}\n❓ Question: ${question}`;
      
      // Save to database
      const chat = new Chat({
        sender: userId,
        receiver: ADMIN_ID,
        message: inquiryMessage,
        messageType: 'product_inquiry',
        metadata: {
          type: 'product_inquiry',
          productId: productId,
          productName: product?.name || productName,
          question: question,
          productData: product ? {
            name: product.name,
            price: product.price,
            stock: product.stock,
            category: product.category
          } : null
        },
        isRead: false
      });
      
      await chat.save();
      
      // Prepare message data
      const inquiryData = {
        _id: chat._id.toString(),
        sender: userId,
        receiver: ADMIN_ID,
        message: inquiryMessage,
        messageType: 'product_inquiry',
        metadata: chat.metadata,
        isRead: false,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      };
      
      // Send to admin room
      io.to(ADMIN_ROOM).emit('receiveMessage', inquiryData);
      console.log(`✅ Product inquiry sent to admin from ${userId}`);
      
      // Send confirmation to user
      socket.emit('messageSent', {
        messageId: chat._id,
        status: 'delivered',
        timestamp: new Date()
      });
      
      // Auto-respond if possible
      if (product && isSimpleInquiry(question)) {
        setTimeout(() => {
          sendAutoResponse(userId, product, question, chat._id);
        }, 1500);
      }
      
    } catch (error) {
      console.error('❌ Product inquiry error:', error);
      socket.emit('inquiryError', { error: 'Failed to process inquiry' });
    }
  });

  // ========== TYPING INDICATOR ==========
  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    const senderId = socket.userId;
    
    if (!senderId || !receiverId) {
      console.error('Missing senderId or receiverId for typing indicator');
      return;
    }
    
    console.log(`⌨️ ${senderId} ${isTyping ? 'is typing' : 'stopped typing'} to ${receiverId}`);
    
    if (receiverId === ADMIN_ID) {
      // User typing to admin
      io.to(ADMIN_ROOM).emit('userTyping', {
        userId: senderId,
        isTyping: isTyping,
        timestamp: new Date()
      });
    } else if (senderId === ADMIN_ID) {
      // Admin typing to user
      const userRoom = `user:${receiverId}`;
      io.to(userRoom).emit('adminTyping', {
        isTyping: isTyping,
        timestamp: new Date()
      });
    } else {
      // User to user typing
      const receiverRoom = `user:${receiverId}`;
      io.to(receiverRoom).emit('userTyping', {
        userId: senderId,
        isTyping: isTyping,
        timestamp: new Date()
      });
    }
  });

  // ========== MARK MESSAGE AS READ ==========
  socket.on('markAsRead', async (data) => {
    try {
      const { messageId, senderId, receiverId } = data;
      
      console.log(`📖 Marking message ${messageId} as read`);
      
      // Update in database
      const Chat = require('./models/Chat');
      const updated = await Chat.findByIdAndUpdate(messageId, {
        isRead: true,
        readAt: new Date()
      }, { new: true });
      
      if (!updated) {
        console.error(`Message ${messageId} not found`);
        return;
      }
      
      // Notify sender that their message was read
      if (senderId && senderId !== socket.userId) {
        if (senderId === ADMIN_ID) {
          // Admin sent message, notify in admin room
          io.to(ADMIN_ROOM).emit('messageRead', {
            messageId: messageId,
            readAt: updated.readAt,
            receiverId: receiverId
          });
        } else {
          // User sent message, notify in their room
          const senderRoom = `user:${senderId}`;
          io.to(senderRoom).emit('messageRead', {
            messageId: messageId,
            readAt: updated.readAt
          });
        }
      }
      
      console.log(`✅ Message ${messageId} marked as read`);
      
    } catch (error) {
      console.error('❌ Mark as read error:', error);
    }
  });

  // ========== GET CHAT HISTORY ==========
  socket.on('getChatHistory', async (data) => {
    try {
      const { userId, targetId } = data;
      
      console.log(`📜 Getting chat history for ${userId} with ${targetId}`);
      
      const Chat = require('./models/Chat');
      const messages = await Chat.find({
        $or: [
          { sender: userId, receiver: targetId },
          { sender: targetId, receiver: userId }
        ]
      })
      .sort({ createdAt: 1 })
      .limit(100);
      
      socket.emit('chatHistory', {
        targetId: targetId,
        messages: messages.map(msg => ({
          _id: msg._id.toString(),
          sender: msg.sender,
          receiver: msg.receiver,
          message: msg.message,
          messageType: msg.messageType,
          metadata: msg.metadata || {},
          isRead: msg.isRead,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
          readAt: msg.readAt
        }))
      });
      
      console.log(`✅ Sent ${messages.length} messages to ${userId}`);
      
    } catch (error) {
      console.error('❌ Get chat history error:', error);
      socket.emit('historyError', { error: 'Failed to get chat history' });
    }
  });

  // ========== DISCONNECT HANDLER ==========
  socket.on('disconnect', (reason) => {
    console.log('👋 Client disconnected:', socket.id, 'Reason:', reason);
    
    const userId = socketUsers.get(socket.id);
    
    if (userId) {
      // Remove from mappings
      userSockets.delete(userId);
      socketUsers.delete(socket.id);
      
      console.log(`👤 User ${userId} disconnected`);
      
      // If admin disconnected
      if (userId === ADMIN_ID || userId.includes('admin')) {
        // Notify all users that admin is offline
        io.emit('adminStatus', { isOnline: false });
        console.log('🛡️ Admin went offline');
      } else {
        // Notify admin that user disconnected
        io.to(ADMIN_ROOM).emit('userDisconnected', {
          userId: userId,
          timestamp: new Date()
        });
        
        // Send user left event to admin room
        io.to(ADMIN_ROOM).emit('userLeft', {
          userId: userId,
          userCount: Array.from(userSockets.keys()).filter(id => 
            id !== ADMIN_ID && !id.includes('admin')
          ).length
        });
        
        console.log(`👤 User ${userId} disconnected, notifying admin`);
      }
    }
  });

  // ========== ERROR HANDLER ==========
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });

  // ========== BROADCAST MESSAGE (Admin to all users) ==========
  socket.on('broadcastMessage', async (data) => {
    try {
      const { message, senderId = ADMIN_ID } = data;
      
      if (!message || !senderId) {
        socket.emit('broadcastError', { error: 'Missing message or senderId' });
        return;
      }
      
      // Save broadcast message for each user
      const Chat = require('./models/Chat');
      const connectedUsers = Array.from(userSockets.keys())
        .filter(id => id !== ADMIN_ID && !id.includes('admin'));
      
      console.log(`📢 Broadcasting message to ${connectedUsers.length} users`);
      
      for (const userId of connectedUsers) {
        const chat = new Chat({
          sender: senderId,
          receiver: userId,
          message: message,
          messageType: 'broadcast',
          isRead: false
        });
        
        await chat.save();
        
        // Send to user's room
        const userRoom = `user:${userId}`;
        io.to(userRoom).emit('receiveMessage', {
          _id: chat._id.toString(),
          sender: senderId,
          receiver: userId,
          message: message,
          messageType: 'broadcast',
          isRead: false,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt
        });
      }
      
      socket.emit('broadcastSent', { 
        count: connectedUsers.length,
        timestamp: new Date()
      });
      
    } catch (error) {
      console.error('❌ Broadcast error:', error);
      socket.emit('broadcastError', { error: 'Failed to broadcast message' });
    }
  });
});

// ========== HELPER FUNCTIONS ==========

function isProductInquiry(message) {
  const productKeywords = [
    'price', 'cost', 'how much',
    'stock', 'available', 'in stock',
    'specification', 'feature', 'detail',
    'delivery', 'shipping', 'dispatch',
    'discount', 'sale', 'offer',
    'compare', 'alternative', 'similar',
    'warranty', 'guarantee', 'return',
    'review', 'rating', 'quality',
    'dimension', 'size', 'weight',
    'color', 'material', 'brand'
  ];
  
  return productKeywords.some(keyword => 
    message.toLowerCase().includes(keyword)
  );
}

function isSimpleInquiry(question) {
  const simpleKeywords = ['price', 'cost', 'how much', 'stock', 'available', 'in stock'];
  return simpleKeywords.some(keyword => 
    question.toLowerCase().includes(keyword)
  );
}

async function handleProductInquiry(userId, question, metadata) {
  try {
    const Product = require('./models/Product');
    
    if (metadata?.productId) {
      const product = await Product.findById(metadata.productId);
      if (product) {
        // Send auto-response for simple inquiries
        if (question.toLowerCase().includes('price') || question.toLowerCase().includes('cost') || question.toLowerCase().includes('how much')) {
          setTimeout(() => {
            sendAutoResponse(userId, product, question, null);
          }, 2000);
        } else if (question.toLowerCase().includes('stock') || question.toLowerCase().includes('available')) {
          setTimeout(() => {
            sendAutoResponse(userId, product, question, null);
          }, 2000);
        }
      }
    }
  } catch (error) {
    console.error('❌ Handle product inquiry error:', error);
  }
}

async function sendAutoResponse(userId, product, question, inquiryId) {
  try {
    const Chat = require('./models/Chat');
    
    let response = '';
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes('price') || lowerQuestion.includes('cost') || lowerQuestion.includes('how much')) {
      response = `💰 **Price Information:**\n`;
      response += `**${product.name}**\n`;
      response += `• Regular Price: $${product.price}\n`;
      if (product.discountPrice && product.discountPrice < product.price) {
        response += `• Sale Price: $${product.discountPrice} (Save ${Math.round((1 - product.discountPrice/product.price) * 100)}%)\n`;
      }
      response += `\n💡 *This is an automated response. For more details, our support team will assist you shortly.*`;
    } 
    else if (lowerQuestion.includes('stock') || lowerQuestion.includes('available')) {
      response = `📦 **Stock Availability:**\n`;
      response += `**${product.name}**\n`;
      response += `• Status: ${product.stock > 0 ? '✅ IN STOCK' : '❌ OUT OF STOCK'}\n`;
      if (product.stock > 0) {
        response += `• Available Units: ${product.stock}\n`;
      }
      response += `\n💡 *This is an automated response. For more details, our support team will assist you shortly.*`;
    }
    
    if (response) {
      // Save auto-response to database
      const chat = new Chat({
        sender: 'admin',
        receiver: userId,
        message: response,
        messageType: 'auto_response',
        isRead: false,
        metadata: {
          type: 'auto_response',
          originalInquiry: inquiryId,
          productId: product._id,
          productName: product.name
        }
      });
      
      await chat.save();
      
      // Send to user's room
      const userRoom = `user:${userId}`;
      io.to(userRoom).emit('receiveMessage', {
        _id: chat._id.toString(),
        sender: 'admin',
        receiver: userId,
        message: response,
        messageType: 'auto_response',
        metadata: chat.metadata,
        isRead: false,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      });
      
      // Notify admin room about auto-response
      io.to(ADMIN_ROOM).emit('autoResponseSent', {
        userId: userId,
        productName: product.name,
        question: question,
        response: response,
        timestamp: new Date()
      });
      
      console.log(`🤖 Auto-response sent to ${userId}`);
    }
    
  } catch (error) {
    console.error('❌ Auto-response error:', error);
  }
}

// Make io accessible to routes
app.set('io', io);

module.exports = io;
// ========== BASIC ROUTES ==========

// Login page
app.get('/login', (req, res) => {
    res.render('auth/login', { title: 'Login' });
});

// Register page
app.get('/register', (req, res) => {
    res.render('auth/register', { title: 'Register' });
});

// Cart page
app.get('/cart', async (req, res) => {
    try {
        const cart = req.session.cart || { 
            items: [], 
            total: 0 
        };
        
        if (!cart.totalItems) {
            cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
        }
        
        res.render('cart/index', { 
            title: 'Shopping Cart',
            cart: {
                items: cart.items,
                totalPrice: cart.total,
                totalItems: cart.totalItems
            }
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

// Update cart item quantity
app.post('/cart/update', (req, res) => {
    try {
        const { index, quantity } = req.body;
        
        if (!req.session.cart || !req.session.cart.items[index]) {
            return res.json({ success: false, error: 'Item not found' });
        }
        
        req.session.cart.items[index].quantity = parseInt(quantity);
        
        req.session.cart.total = req.session.cart.items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
        
        req.session.cartCount = req.session.cart.items.reduce((sum, item) => {
            return sum + item.quantity;
        }, 0);
        
        res.json({ 
            success: true, 
            total: req.session.cart.total,
            cartCount: req.session.cartCount
        });
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// Remove item from cart
app.post('/cart/remove', (req, res) => {
    try {
        const { index } = req.body;
        
        if (!req.session.cart || !req.session.cart.items[index]) {
            return res.json({ success: false, error: 'Item not found' });
        }
        
        req.session.cart.items.splice(index, 1);
        
        req.session.cart.total = req.session.cart.items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
        
        req.session.cartCount = req.session.cart.items.reduce((sum, item) => {
            return sum + item.quantity;
        }, 0);
        
        res.json({ 
            success: true, 
            total: req.session.cart.total,
            cartCount: req.session.cartCount
        });
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// Clear cart
app.post('/cart/clear', (req, res) => {
    try {
        req.session.cart = { items: [], total: 0 };
        req.session.cartCount = 0;
        
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// Category pages
app.get('/electronics', async (req, res) => {
    try {
        const category = await Category.findOne({ slug: 'electronics' });
        let products = [];
        
        if (category) {
            products = await Product.find({ 
                category: category._id,
                isActive: true 
            }).limit(12);
        }
        
        const categories = await Category.find({ parent: null, isActive: true });
        
        res.render('products/index', {
            title: 'Electronics',
            products,
            categories,
            query: { category: 'electronics' }
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

app.get('/fashion', async (req, res) => {
    try {
        const category = await Category.findOne({ slug: 'fashion' });
        let products = [];
        
        if (category) {
            products = await Product.find({ 
                category: category._id,
                isActive: true 
            }).limit(12);
        }
        
        const categories = await Category.find({ parent: null, isActive: true });
        
        res.render('products/index', {
            title: 'Fashion',
            products,
            categories,
            query: { category: 'fashion' }
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

app.get('/home', async (req, res) => {
    try {
        const category = await Category.findOne({ slug: 'home' });
        let products = [];
        
        if (category) {
            products = await Product.find({ 
                category: category._id,
                isActive: true 
            }).limit(12);
        }
        
        const categories = await Category.find({ parent: null, isActive: true });
        
        res.render('products/index', {
            title: 'Home & Kitchen',
            products,
            categories,
            query: { category: 'home' }
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

app.get('/sports', async (req, res) => {
    try {
        const category = await Category.findOne({ slug: 'sports' });
        let products = [];
        
        if (category) {
            products = await Product.find({ 
                category: category._id,
                isActive: true 
            }).limit(12);
        }
        
        const categories = await Category.find({ parent: null, isActive: true });
        
        res.render('products/index', {
            title: 'Sports',
            products,
            categories,
            query: { category: 'sports' }
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

// Product search
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        
        if (!query) {
            return res.redirect('/products');
        }
        
        const products = await Product.find({
            name: { $regex: query, $options: 'i' },
            isActive: true
        }).limit(20);
        
        const categories = await Category.find({ parent: null, isActive: true });
        
        res.render('products/index', {
            title: `Search: ${query}`,
            products,
            categories,
            query: { q: query }
        });
    } catch (error) {
        console.error(error);
        res.redirect('/products');
    }
});

// Products listing
app.get('/products', async (req, res) => {
    try {
        let query = { isActive: true };
        
        if (req.query.category) {
            const category = await Category.findOne({ slug: req.query.category });
            if (category) {
                query.category = category._id;
            }
        }
        
        const categories = await Category.find({ parent: null, isActive: true });
        
        const products = await Product.find(query)
            .populate('category')
            .limit(20);
        
        res.render('products/index', {
            title: 'Products',
            products,
            categories,
            query: req.query
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

// Product details
app.get('/products/:slug', async (req, res) => {
    try {
        const product = await Product.findOne({ slug: req.params.slug })
            .populate('category');
        
        if (!product) {
            return res.status(404).render('error', { 
                title: 'Not Found',
                error: 'Product not found' 
            });
        }
        
        res.render('products/detail', {
            title: product.name,
            product
        });
    } catch (error) {
        console.error(error);
        res.status(500).render('error', { 
            title: 'Error',
            error: 'Something went wrong' 
        });
    }
});

// Add to cart API
app.post('/cart/add', async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        
        if (!req.session.cart) {
            req.session.cart = { items: [], total: 0 };
        }
        
        const product = await Product.findById(productId);
        if (!product) {
            return res.json({ success: false, error: 'Product not found' });
        }
        
        const existingItemIndex = req.session.cart.items.findIndex(
            item => item.productId === productId
        );
        
        if (existingItemIndex > -1) {
            req.session.cart.items[existingItemIndex].quantity += parseInt(quantity);
        } else {
            req.session.cart.items.push({
                productId: productId,
                name: product.name,
                price: product.discountPrice || product.price,
                quantity: parseInt(quantity),
                image: product.images && product.images[0]
            });
        }
        
        req.session.cart.total = req.session.cart.items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
        
        req.session.cartCount = req.session.cart.items.reduce((sum, item) => {
            return sum + item.quantity;
        }, 0);
        
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.json({ success: false, error: 'Failed to save cart' });
            }
            
            res.json({
                success: true,
                cartCount: req.session.cartCount,
                totalPrice: req.session.cart.total
            });
        });
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// Home route
app.get('/', async (req, res) => {
    try {
        const featuredProducts = await Product.find({ 
            isFeatured: true, 
            isActive: true 
        }).limit(4);
        
        const categories = await Category.find({ parent: null, isActive: true }).limit(4);
        
        res.render('home', { 
            title: 'Home',
            featuredProducts,
            categories
        });
    } catch (error) {
        console.error(error);
        res.render('home', { 
            title: 'Home',
            featuredProducts: [],
            categories: []
        });
    }
});

// ========== IMPORT ROUTE MODULES ==========
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const userOrdersRoutes = require('./routes/user-orders'); 
const checkoutRoutes = require('./routes/checkout');    
const userChatRoutes = require('./routes/user-chat'); 
const adminChatRoutes = require('./routes/admin-chat');  
const adminRoutes = require('./routes/admin');   
const adminOrdersRoutes = require('./routes/admin-orders');   
    

// ========== USE ROUTES ==========
app.use('/auth', authRoutes);
app.use('/orders', orderRoutes);
app.use('/my-orders', userOrdersRoutes);
app.use('/checkout', checkoutRoutes);  
app.use('/chat', userChatRoutes);     
app.use('/admin/chat', adminChatRoutes); 
app.use('/admin', adminRoutes);      
app.use('/admin', adminOrdersRoutes);    

// ========== API ROUTES ==========
app.get('/api/products/featured', async (req, res) => {
    try {
        const products = await Product.find({ 
            isFeatured: true, 
            isActive: true 
        }).limit(8);
        res.json(products);
    } catch (error) {
        console.error('Error fetching featured products:', error);
        res.json([]);
    }
});

// ========== ERROR HANDLING ==========
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        title: 'Error', 
        error: 'Something went wrong! Please try again later.'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', { 
        title: 'Page Not Found', 
        error: 'The page you are looking for does not exist.'
    });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`👉 Access: http://localhost:${PORT}`);
    console.log('\n=== Login Credentials ===');
    console.log('Admin: admin@noon.com / admin123');
    console.log('User: john@example.com / user123');
    console.log('=========================');
    console.log('\n=== Important Routes ===');
    console.log('Home: http://localhost:3000');
    console.log('Admin Dashboard: http://localhost:3000/admin/dashboard');
    console.log('User chat: http://localhost:3000/chat');
    console.log('Admin chat: http://localhost:3000/admin/chat');
    console.log('=========================');
    console.log('\n=== Debug Routes ===');
    console.log('Session debug: http://localhost:3000/debug/session');
    console.log('User debug: http://localhost:3000/debug/user');
    console.log('=========================');
});