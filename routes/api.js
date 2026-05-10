// routes/api.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); 
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Review = require('../models/Review');
const Chat = require('../models/Chat');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// ========== PUBLIC API ROUTES ==========

// Health Check
router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'E-commerce API',
        version: '1.0.0'
    });
});

// Featured Products
router.get('/products/featured', async (req, res) => {
    try {
        const featuredProducts = await Product.find({ 
            isFeatured: true, 
            isActive: true 
        })
        .limit(8)
        .populate({
            path: 'category',
            select: 'name slug',
            strictPopulate: false
        });

        res.json({ products: featuredProducts });
    } catch (error) {
        console.error('Get featured products error:', error);
        res.status(500).json({ message: 'Error fetching featured products', error: error.message });
    }
});

// Get all products (public)
router.get('/products', async (req, res) => {
    try {
        const { category, search, page = 1, limit = 10 } = req.query;
        const query = { isActive: true };
        
        if (category) {
            const categoryDoc = await Category.findOne({ slug: category });
            if (categoryDoc) {
                query.category = categoryDoc._id;
            }
        }
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }
        
        const products = await Product.find(query)
            .populate('category', 'name slug')
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });
        
        const total = await Product.countDocuments(query);
        
        res.json({
            products,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ message: 'Error fetching products', error: error.message });
    }
});


// In your backend routes (api.js or productRoutes.js)

// Remove these routes:
// router.get('/products/:id', async (req, res) => {...});
// router.get('/products/slug/:slug', async (req, res) => {...});

// Keep only this one:
// GET /api/products/:identifier - Get single product by ID or slug
router.get('/products/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    console.log('Fetching product with identifier:', identifier);
    
    // Check if identifier is a valid MongoDB ObjectId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
    
    let query;
    if (isObjectId) {
      // Search by _id
      query = Product.findById(identifier);
    } else {
      // Search by slug
      query = Product.findOne({ slug: identifier });
    }
    
    // Populate category and subcategory
    query = query
      .populate('category', 'name slug')
      .populate('subcategory', 'name slug');
    
    const product = await query;
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    res.json({
      success: true,
      product: product
    });
    
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
});

// Get all categories
router.get('/categories', async (req, res) => {
    try {
        const categories = await Category.find({ isActive: true, parent: null });
        res.json({ categories });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ 
            message: 'Error fetching categories', 
            error: error.message 
        });
    }
});

// Get category by slug
router.get('/categories/:slug', async (req, res) => {
    try {
        const category = await Category.findOne({ 
            slug: req.params.slug, 
            isActive: true 
        });
        
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }
        
        res.json({ category });
    } catch (error) {
        console.error('Get category by slug error:', error);
        res.status(500).json({ message: 'Error fetching category', error: error.message });
    }
});

// Get subcategories
router.get('/categories/:parentId/subcategories', async (req, res) => {
    try {
        const subcategories = await Category.find({ 
            parent: req.params.parentId, 
            isActive: true 
        });
        res.json({ categories: subcategories });
    } catch (error) {
        console.error('Get subcategories error:', error);
        res.status(500).json({ message: 'Error fetching subcategories', error: error.message });
    }
});

// Search products
router.get('/search', async (req, res) => {
    try {
        const { q, minPrice, maxPrice, category, sort = 'newest' } = req.query;
        
        let query = { isActive: true };
        
        // Search term
        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
                { brand: { $regex: q, $options: 'i' } }
            ];
        }
        
        // Price range
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = parseFloat(minPrice);
            if (maxPrice) query.price.$lte = parseFloat(maxPrice);
        }
        
        // Category filter
        if (category) {
            const categoryDoc = await Category.findOne({ slug: category });
            if (categoryDoc) {
                query.category = categoryDoc._id;
            }
        }
        
        // Sorting
        let sortOption = {};
        switch (sort) {
            case 'price_asc':
                sortOption = { price: 1 };
                break;
            case 'price_desc':
                sortOption = { price: -1 };
                break;
            case 'rating':
                sortOption = { rating: -1 };
                break;
            case 'newest':
            default:
                sortOption = { createdAt: -1 };
        }
        
        const products = await Product.find(query)
            .populate('category', 'name slug')
            .sort(sortOption)
            .limit(20);
        
        res.json({ products });
    } catch (error) {
        console.error('Search products error:', error);
        res.status(500).json({ message: 'Error searching products', error: error.message });
    }
});

// Get product reviews
router.get('/reviews/product/:productId', async (req, res) => {
    try {
        const reviews = await Review.find({ product: req.params.productId })
            .populate('user', 'name')
            .sort({ createdAt: -1 });
        
        res.json({ reviews });
    } catch (error) {
        console.error('Get reviews error:', error);
        res.status(500).json({ message: 'Error fetching reviews', error: error.message });
    }
});

// ========== AUTH ROUTES ==========

// Register
router.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }
        
        const user = new User({ name, email, password });
        await user.save();
        
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );
        
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
});

// Login
router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );
        
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
});

// Get profile
router.get('/auth/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ user });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ message: 'Error fetching profile', error: error.message });
    }
});

// Update profile
router.put('/auth/profile', authenticateToken, async (req, res) => {
    try {
        const { name, phone, avatar } = req.body;
        
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (avatar) user.avatar = avatar;
        
        await user.save();
        
        res.json({ 
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                avatar: user.avatar,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ message: 'Error updating profile', error: error.message });
    }
});

// ========== CART ROUTES ==========

// Get cart
router.get('/cart', authenticateToken, async (req, res) => {
    try {
        console.log('=== GET CART ===');
        console.log('User ID:', req.user.userId);
        
        let cart = await Cart.findOne({ user: req.user.userId })
            .populate('items.product', 'name price images stock brand slug');
        
        if (!cart) {
            console.log('No cart found, creating empty cart');
            cart = new Cart({
                user: req.user.userId,
                items: [],
                totalPrice: 0,
                totalItems: 0
            });
            await cart.save();
        }
        
        console.log('Cart found with', cart.items.length, 'items');
        
        res.json({ 
            success: true,
            message: 'Cart retrieved successfully',
            cart 
        });
    } catch (error) {
        console.error('Get cart error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error fetching cart',
            error: error.message 
        });
    }
});

// Add to cart
router.post('/cart/add', authenticateToken, async (req, res) => {
    console.log('=== ADD TO CART ===');
    console.log('Body:', req.body);
    console.log('User ID:', req.user.userId);
    
    try {
        const { productId, quantity = 1 } = req.body;
        
        if (!productId) {
            return res.status(400).json({ 
                success: false,
                message: 'Product ID is required' 
            });
        }
        
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ 
                success: false,
                message: 'Product not found' 
            });
        }
        
        if (!product.isActive) {
            return res.status(400).json({ 
                success: false,
                message: 'Product is not available' 
            });
        }
        
        if (product.stock < quantity) {
            return res.status(400).json({ 
                success: false,
                message: `Only ${product.stock} items available` 
            });
        }
        
        let cart = await Cart.findOne({ user: req.user.userId });
        
        if (!cart) {
            cart = new Cart({ 
                user: req.user.userId, 
                items: []
            });
        }
        
        const existingItemIndex = cart.items.findIndex(item => 
            item.product && item.product.toString() === productId
        );
        
        if (existingItemIndex > -1) {
            const newQuantity = cart.items[existingItemIndex].quantity + quantity;
            
            if (product.stock < newQuantity) {
                return res.status(400).json({ 
                    success: false,
                    message: `Cannot add more items. Only ${product.stock} available in stock` 
                });
            }
            
            cart.items[existingItemIndex].quantity = newQuantity;
            cart.items[existingItemIndex].price = product.price;
            cart.items[existingItemIndex].name = product.name;
            cart.items[existingItemIndex].image = product.images?.[0] || '';
            cart.items[existingItemIndex].brand = product.brand || '';
        } else {
            cart.items.push({
                product: productId,
                quantity: quantity,
                price: product.price,
                name: product.name,
                image: product.images?.[0] || '',
                brand: product.brand || ''
            });
        }
        
        cart.totalItems = cart.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        cart.totalPrice = cart.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
        
        await cart.save();
        
        const populatedCart = await Cart.findById(cart._id)
            .populate('items.product', 'name price images stock brand slug');
        
        res.json({ 
            success: true,
            message: 'Added to cart successfully',
            cart: populatedCart
        });
        
    } catch (error) {
        console.error('Add to cart error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error adding to cart',
            error: error.message
        });
    }
});

// Update cart item
router.put('/cart/update/:itemId', authenticateToken, async (req, res) => {
    console.log('=== UPDATE CART ITEM ===');
    console.log('Item ID:', req.params.itemId);
    console.log('Body:', req.body);
    
    try {
        const { quantity } = req.body;
        
        if (!quantity || quantity < 1 || quantity > 999) {
            return res.status(400).json({ 
                success: false,
                message: 'Quantity must be between 1 and 999' 
            });
        }
        
        const cart = await Cart.findOne({ user: req.user.userId });
        if (!cart) {
            return res.status(404).json({ 
                success: false,
                message: 'Cart not found' 
            });
        }
        
        const item = cart.items.id(req.params.itemId);
        if (!item) {
            return res.status(404).json({ 
                success: false,
                message: 'Item not found in cart' 
            });
        }
        
        const product = await Product.findById(item.product);
        if (product && quantity > product.stock) {
            return res.status(400).json({ 
                success: false,
                message: `Only ${product.stock} items available` 
            });
        }
        
        item.quantity = quantity;
        
        cart.totalItems = cart.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        cart.totalPrice = cart.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
        
        await cart.save();
        
        const populatedCart = await Cart.findById(cart._id)
            .populate('items.product', 'name price images stock brand slug');
        
        res.json({ 
            success: true,
            message: 'Cart updated successfully',
            cart: populatedCart
        });
        
    } catch (error) {
        console.error('Update cart error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error updating cart',
            error: error.message
        });
    }
});

// Remove from cart
router.delete('/cart/remove/:itemId', authenticateToken, async (req, res) => {
    console.log('=== REMOVE CART ITEM ===');
    console.log('Item ID:', req.params.itemId);
    
    try {
        const cart = await Cart.findOne({ user: req.user.userId });
        if (!cart) {
            return res.status(404).json({ 
                success: false,
                message: 'Cart not found' 
            });
        }
        
        const itemIndex = cart.items.findIndex(item => item._id.toString() === req.params.itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ 
                success: false,
                message: 'Item not found in cart' 
            });
        }
        
        cart.items.splice(itemIndex, 1);
        
        cart.totalItems = cart.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        cart.totalPrice = cart.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
        
        await cart.save();
        
        const populatedCart = await Cart.findById(cart._id)
            .populate('items.product', 'name price images stock brand slug');
        
        res.json({ 
            success: true,
            message: 'Item removed from cart',
            cart: populatedCart
        });
        
    } catch (error) {
        console.error('Remove cart item error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error removing item from cart',
            error: error.message
        });
    }
});

// Clear cart
router.delete('/cart/clear', authenticateToken, async (req, res) => {
    console.log('=== CLEAR CART ===');
    console.log('User ID:', req.user.userId);
    
    try {
        const cart = await Cart.findOne({ user: req.user.userId });
        if (!cart) {
            return res.status(404).json({ 
                success: false,
                message: 'Cart not found' 
            });
        }
        
        cart.items = [];
        cart.totalItems = 0;
        cart.totalPrice = 0;
        
        await cart.save();
        
        res.json({ 
            success: true,
            message: 'Cart cleared successfully',
            cart
        });
        
    } catch (error) {
        console.error('Clear cart error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error clearing cart',
            error: error.message
        });
    }
});

// Apply coupon
router.put('/cart/apply-coupon', authenticateToken, async (req, res) => {
    try {
        const { couponCode } = req.body;
        
        if (!couponCode) {
            return res.status(400).json({
                success: false,
                message: 'Coupon code is required'
            });
        }
        
        const cart = await Cart.findOne({ user: req.user.userId });
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }
        
        const discount = 0.1;
        const discountAmount = cart.totalPrice * discount;
        
        res.json({
            success: true,
            message: 'Coupon applied successfully',
            discount: discountAmount,
            newTotal: cart.totalPrice - discountAmount
        });
        
    } catch (error) {
        console.error('Apply coupon error:', error);
        res.status(500).json({
            success: false,
            message: 'Error applying coupon',
            error: error.message
        });
    }
});

// ========== ORDER ROUTES ==========

// Get user orders
router.get('/orders', authenticateToken, async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.userId })
            .sort({ createdAt: -1 })
            .populate('items.product', 'name images');
        
        res.json({ orders });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ message: 'Error fetching orders', error: error.message });
    }
});

// Get order by ID
router.get('/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const order = await Order.findOne({ 
            orderId: req.params.orderId,
            user: req.user.userId 
        })
        .populate('items.product', 'name images description')
        .populate('user', 'name email');
        
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        
        res.json({ order });
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ message: 'Error fetching order', error: error.message });
    }
});

// Create order
router.post('/orders/create', authenticateToken, async (req, res) => {
    try {
        const { items, shippingAddress, paymentMethod } = req.body;
        
        if (!items || items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No items in order' 
            });
        }
        
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const shippingFee = 10;
        const tax = subtotal * 0.1;
        const totalAmount = subtotal + shippingFee + tax;
        
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const order = new Order({
            orderId,
            user: req.user.userId,
            items: items.map(item => ({
                product: item.product._id || item.product,
                name: item.name || item.product.name,
                quantity: item.quantity,
                price: item.price,
                color: item.color,
                size: item.size,
                subtotal: item.price * item.quantity
            })),
            shippingAddress,
            paymentMethod: paymentMethod === 'paypal_sandbox' ? 'paypal' : paymentMethod,
            paymentStatus: paymentMethod === 'cod' ? 'pending' : 'completed',
            status: 'pending',
            subtotal,
            shippingFee,
            tax,
            totalAmount
        });
        
        await order.save();
        
        await Cart.findOneAndUpdate(
            { user: req.user.userId },
            { items: [], totalPrice: 0, totalItems: 0 }
        );
        
        res.status(201).json({ 
            success: true,
            message: 'Order created successfully',
            order 
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error creating order', 
            error: error.message 
        });
    }
});

// Cancel order
router.put('/orders/:orderId/cancel', authenticateToken, async (req, res) => {
    try {
        const order = await Order.findOne({ 
            orderId: req.params.orderId,
            user: req.user.userId 
        });
        
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        
        if (order.status === 'cancelled') {
            return res.status(400).json({ message: 'Order is already cancelled' });
        }
        
        if (order.status === 'delivered') {
            return res.status(400).json({ message: 'Cannot cancel delivered order' });
        }
        
        order.status = 'cancelled';
        order.cancelledAt = new Date();
        await order.save();
        
        res.json({ 
            message: 'Order cancelled successfully',
            order 
        });
    } catch (error) {
        console.error('Cancel order error:', error);
        res.status(500).json({ message: 'Error cancelling order', error: error.message });
    }
});

// ========== CHECKOUT ROUTES ==========

// Process checkout
router.post('/checkout/process', authenticateToken, async (req, res) => {
    console.log('=== PROCESS CHECKOUT ===');
    console.log('User ID:', req.user.userId);
    console.log('Payment method:', req.body.paymentMethod);
    
    try {
        const { paymentMethod, shippingAddress, items, subtotal, shipping, tax, totalAmount } = req.body;
        
        if (!paymentMethod || !shippingAddress || !items || items.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Missing required checkout information' 
            });
        }
        
        const cart = await Cart.findOne({ user: req.user.userId });
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Your cart is empty' 
            });
        }
        
        let paymentStatus = 'completed';
        let orderStatus = 'processing';
        let paymentResult = 'success';
        
        if (paymentMethod === 'paypal_sandbox') {
            paymentStatus = 'completed';
            orderStatus = 'processing';
            paymentResult = 'success';
        } else if (paymentMethod === 'demo') {
            paymentStatus = 'completed';
            orderStatus = 'processing';
            paymentResult = 'success';
        } else if (paymentMethod === 'fail') {
            paymentStatus = 'failed';
            orderStatus = 'cancelled';
            paymentResult = 'failed';
            
            return res.json({
                success: false,
                message: 'Payment simulation failed as requested',
                paymentResult: 'failed'
            });
        }
        
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const order = new Order({
            orderId,
            user: req.user.userId,
            items: items.map(item => ({
                product: item.product,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                color: item.color,
                size: item.size,
                subtotal: item.price * item.quantity
            })),
            shippingAddress,
            paymentMethod: paymentMethod === 'paypal_sandbox' ? 'paypal' : paymentMethod,
            paymentStatus,
            status: orderStatus,
            subtotal,
            shippingFee: shipping,
            tax,
            totalAmount
        });
        
        await order.save();
        
        if (paymentResult === 'success') {
            await Cart.findOneAndUpdate(
                { user: req.user.userId },
                { items: [], totalPrice: 0, totalItems: 0 }
            );
        }
        
        res.json({ 
            success: true,
            message: 'Order placed successfully!',
            order: {
                _id: order._id,
                orderId: order.orderId,
                status: order.status,
                totalAmount: order.totalAmount,
                createdAt: order.createdAt
            },
            paymentResult,
            redirectUrl: `/orders/${order.orderId}`
        });
        
    } catch (error) {
        console.error('Checkout processing error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error processing checkout',
            error: error.message
        });
    }
});

// ========== REVIEW ROUTES ==========

// Add review
router.post('/reviews', authenticateToken, async (req, res) => {
    try {
        const { productId, rating, comment } = req.body;
        
        if (!productId || !rating) {
            return res.status(400).json({ message: 'Product ID and rating are required' });
        }
        
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5' });
        }
        
        const existingReview = await Review.findOne({
            user: req.user.userId,
            product: productId
        });
        
        if (existingReview) {
            return res.status(400).json({ message: 'You have already reviewed this product' });
        }
        
        const review = new Review({
            user: req.user.userId,
            product: productId,
            rating,
            comment
        });
        
        await review.save();
        
        res.status(201).json({ 
            message: 'Review added successfully',
            review 
        });
    } catch (error) {
        console.error('Add review error:', error);
        res.status(500).json({ message: 'Error adding review', error: error.message });
    }
});

// ========== CHAT ROUTES ==========

// Get chat messages
router.get('/chat/messages', authenticateToken, async (req, res) => {
    try {
        const messages = await Chat.find({
            $or: [
                { sender: req.user.userId, receiver: 'admin' },
                { sender: 'admin', receiver: req.user.userId }
            ]
        }).sort({ createdAt: 1 }).limit(50);
        
        res.json({ messages });
    } catch (error) {
        console.error('Get chat messages error:', error);
        res.status(500).json({ message: 'Error fetching messages', error: error.message });
    }
});

// Send message
router.post('/chat/send', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({ message: 'Message is required' });
        }
        
        const chat = new Chat({
            sender: req.user.userId,
            receiver: 'admin',
            message: message.trim()
        });
        
        await chat.save();
        
        res.status(201).json({ 
            message: 'Message sent',
            chat 
        });
    } catch (error) {
        console.error('Send chat error:', error);
        res.status(500).json({ message: 'Error sending message', error: error.message });
    }
});

// Mark messages as read
router.put('/chat/messages/read', authenticateToken, async (req, res) => {
    try {
        await Chat.updateMany(
            { 
                receiver: req.user.userId,
                isRead: false 
            },
            { 
                isRead: true,
                readAt: new Date()
            }
        );
        
        res.json({ message: 'Messages marked as read' });
    } catch (error) {
        console.error('Mark messages as read error:', error);
        res.status(500).json({ message: 'Error marking messages as read', error: error.message });
    }
});
// Add to your chat routes

// Get unread messages count
router.get('/chat/unread-count', authenticateToken, async (req, res) => {
    try {
        const count = await Chat.countDocuments({
            receiver: req.user.userId,
            isRead: false
        });
        
        res.json({ count });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ message: 'Error fetching unread count', error: error.message });
    }
});

// Mark specific messages as read
router.post('/chat/mark-read', authenticateToken, async (req, res) => {
    try {
        const { messageIds } = req.body;
        
        await Chat.updateMany(
            { 
                _id: { $in: messageIds },
                receiver: req.user.userId
            },
            { 
                isRead: true,
                readAt: new Date()
            }
        );
        
        res.json({ message: 'Messages marked as read' });
    } catch (error) {
        console.error('Mark messages as read error:', error);
        res.status(500).json({ message: 'Error marking messages as read', error: error.message });
    }
});

// Product suggestions for chat
router.get('/chat/product-suggestions', authenticateToken, async (req, res) => {
    try {
        const { search } = req.query;
        
        const products = await Product.find({
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ]
        })
        .select('name price image stock description')
        .limit(5);
        
        res.json(products);
    } catch (error) {
        console.error('Product suggestions error:', error);
        res.status(500).json({ message: 'Error fetching product suggestions', error: error.message });
    }
});

// ========== USER ROUTES ==========

// Get addresses
router.get('/user/addresses', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('addresses');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ addresses: user.addresses });
    } catch (error) {
        console.error('Get addresses error:', error);
        res.status(500).json({ message: 'Error fetching addresses', error: error.message });
    }
});

// Add address
router.post('/user/addresses', authenticateToken, async (req, res) => {
    try {
        const { street, city, state, country, zipCode, isDefault } = req.body;
        
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const newAddress = {
            street,
            city,
            state,
            country,
            zipCode,
            isDefault: isDefault || false
        };
        
        if (isDefault) {
            user.addresses.forEach(addr => {
                addr.isDefault = false;
            });
        }
        
        user.addresses.push(newAddress);
        await user.save();
        
        res.status(201).json({ 
            message: 'Address added successfully',
            addresses: user.addresses
        });
    } catch (error) {
        console.error('Add address error:', error);
        res.status(500).json({ message: 'Error adding address', error: error.message });
    }
});

// Update address
router.put('/user/addresses/:addressId', authenticateToken, async (req, res) => {
    try {
        const { street, city, state, country, zipCode, isDefault } = req.body;
        
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const addressIndex = user.addresses.findIndex(
            addr => addr._id.toString() === req.params.addressId
        );
        
        if (addressIndex === -1) {
            return res.status(404).json({ message: 'Address not found' });
        }
        
        if (street) user.addresses[addressIndex].street = street;
        if (city) user.addresses[addressIndex].city = city;
        if (state) user.addresses[addressIndex].state = state;
        if (country) user.addresses[addressIndex].country = country;
        if (zipCode) user.addresses[addressIndex].zipCode = zipCode;
        
        if (isDefault) {
            user.addresses.forEach(addr => {
                addr.isDefault = false;
            });
            user.addresses[addressIndex].isDefault = true;
        } else if (isDefault === false) {
            user.addresses[addressIndex].isDefault = false;
        }
        
        await user.save();
        
        res.json({ 
            message: 'Address updated successfully',
            addresses: user.addresses
        });
    } catch (error) {
        console.error('Update address error:', error);
        res.status(500).json({ message: 'Error updating address', error: error.message });
    }
});

// Delete address
router.delete('/user/addresses/:addressId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const initialLength = user.addresses.length;
        user.addresses = user.addresses.filter(
            addr => addr._id.toString() !== req.params.addressId
        );
        
        if (user.addresses.length === initialLength) {
            return res.status(404).json({ message: 'Address not found' });
        }
        
        await user.save();
        
        res.json({ 
            message: 'Address deleted successfully',
            addresses: user.addresses
        });
    } catch (error) {
        console.error('Delete address error:', error);
        res.status(500).json({ message: 'Error deleting address', error: error.message });
    }
});

// ========== WISHLIST ROUTES ==========

// Get wishlist
router.get('/user/wishlist', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .populate('wishlist', 'name price images slug');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json({ wishlist: user.wishlist });
    } catch (error) {
        console.error('Get wishlist error:', error);
        res.status(500).json({ message: 'Error fetching wishlist', error: error.message });
    }
});

// Add to wishlist
router.post('/user/wishlist', authenticateToken, async (req, res) => {
    try {
        const { productId } = req.body;
        
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        
        if (user.wishlist.includes(productId)) {
            return res.status(400).json({ message: 'Product already in wishlist' });
        }
        
        user.wishlist.push(productId);
        await user.save();
        
        res.json({ 
            message: 'Product added to wishlist',
            wishlist: user.wishlist
        });
    } catch (error) {
        console.error('Add to wishlist error:', error);
        res.status(500).json({ message: 'Error adding to wishlist', error: error.message });
    }
});

// Remove from wishlist
router.delete('/user/wishlist/:productId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const initialLength = user.wishlist.length;
        user.wishlist = user.wishlist.filter(
            id => id.toString() !== req.params.productId
        );
        
        if (user.wishlist.length === initialLength) {
            return res.status(404).json({ message: 'Product not found in wishlist' });
        }
        
        await user.save();
        
        res.json({ 
            message: 'Product removed from wishlist',
            wishlist: user.wishlist
        });
    } catch (error) {
        console.error('Remove from wishlist error:', error);
        res.status(500).json({ message: 'Error removing from wishlist', error: error.message });
    }
});

// ========== USER STATS ==========

// Get user stats
router.get('/user/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const [orders, cart, wishlist] = await Promise.all([
            Order.countDocuments({ user: userId }),
            Cart.findOne({ user: userId }),
            User.findById(userId).select('wishlist')
        ]);
        
        const totalOrders = orders || 0;
        const cartItems = cart ? cart.totalItems : 0;
        const wishlistCount = wishlist ? wishlist.wishlist.length : 0;
        
        res.json({
            stats: {
                totalOrders,
                cartItems,
                wishlistCount
            }
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ message: 'Error fetching user statistics', error: error.message });
    }
});

// Get full profile with addresses and wishlist
router.get('/profile/full', async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('wishlist')
      .select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update password
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    
    user.password = newPassword;
    await user.save();
    
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Manage addresses
router.post('/addresses', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // If this is first address or marked as default, set it as default
    const newAddress = req.body;
    if (user.addresses.length === 0 || newAddress.isDefault) {
      // Remove default from existing addresses
      user.addresses.forEach(addr => addr.isDefault = false);
      newAddress.isDefault = true;
    }
    
    user.addresses.push(newAddress);
    await user.save();
    
    res.json({ success: true, user: await User.findById(req.user._id).select('-password') });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update address
router.put('/addresses/:addressId', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const addressId = req.params.addressId;
    
    const addressIndex = user.addresses.findIndex(addr => addr._id.toString() === addressId);
    if (addressIndex === -1) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    
    // If setting as default, remove default from others
    if (req.body.isDefault) {
      user.addresses.forEach(addr => addr.isDefault = false);
    }
    
    user.addresses[addressIndex] = { ...user.addresses[addressIndex].toObject(), ...req.body };
    await user.save();
    
    res.json({ success: true, user: await User.findById(req.user._id).select('-password') });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete address
router.delete('/addresses/:addressId', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const addressId = req.params.addressId;
    
    user.addresses = user.addresses.filter(addr => addr._id.toString() !== addressId);
    await user.save();
    
    res.json({ success: true, user: await User.findById(req.user._id).select('-password') });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Set default address
router.patch('/addresses/:addressId/default', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const addressId = req.params.addressId;
    
    // Remove default from all addresses
    user.addresses.forEach(addr => addr.isDefault = false);
    
    // Set the specified address as default
    const address = user.addresses.find(addr => addr._id.toString() === addressId);
    if (address) {
      address.isDefault = true;
    }
    
    await user.save();
    
    res.json({ success: true, user: await User.findById(req.user._id).select('-password') });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// // Upload avatar
// router.post('/avatar', upload.single('avatar'), async (req, res) => {
//   try {
//     const user = await User.findById(req.user._id);
    
//     if (req.file) {
//       user.avatar = `/uploads/${req.file.filename}`;
//       await user.save();
      
//       res.json({ 
//         success: true, 
//         user: await User.findById(req.user._id).select('-password') 
//       });
//     } else {
//       res.status(400).json({ success: false, message: 'No file uploaded' });
//     }
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });
module.exports = router;