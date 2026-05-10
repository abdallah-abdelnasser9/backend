// routes/admin-api.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Chat = require('../models/Chat');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// routes/admin-api.js - Fix the isAdmin middleware
const isAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        console.log('Admin middleware - Token:', token ? 'Present' : 'Missing');
        console.log('Admin middleware - Full header:', authHeader);
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Access token required' 
            });
        }
        
        // Wrap jwt.verify in a promise to use async/await properly
        const decoded = await new Promise((resolve, reject) => {
            jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(decoded);
                }
            });
        });
        
        req.user = decoded;
        
        const user = await User.findById(req.user.userId || req.user.id);
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        if (user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }
        
        console.log('Admin middleware - User authorized:', user.email, user.role);
        next();
    } catch (error) {
        console.error('Admin middleware error:', error.message);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ 
                success: false, 
                message: 'Invalid token' 
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({ 
                success: false, 
                message: 'Token expired' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
};
// Apply admin middleware to all routes
router.use(isAdmin);

// ========== DASHBOARD ROUTES ==========

// GET /api/admin/dashboard - Get dashboard statistics
router.get('/dashboard', async (req, res) => {
    try {
        // Get total sales
        const totalSalesAgg = await Order.aggregate([
            { $match: { paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalSales = totalSalesAgg.length > 0 ? totalSalesAgg[0].total : 0;

        // Get other stats
        const totalOrders = await Order.countDocuments();
        const totalProducts = await Product.countDocuments();
        const totalCustomers = await User.countDocuments({ role: 'user' });

        // Recent orders
        const recentOrders = await Order.find()
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .limit(5);

        // Low stock products
        const lowStockProducts = await Product.find({
            stock: { $lte: 10 },
            isActive: true
        }).limit(5);

        // Monthly sales data
        const now = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(now.getMonth() - 6);

        const monthlySales = await Order.aggregate([
            {
                $match: {
                    paymentStatus: 'completed',
                    createdAt: { $gte: sixMonthsAgo }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    total: { $sum: '$totalAmount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        res.json({
            success: true,
            stats: {
                totalSales,
                totalOrders,
                totalProducts,
                totalCustomers
            },
            recentOrders,
            lowStockProducts,
            monthlySales
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== PRODUCT ROUTES ==========

// GET /api/admin/products - Get all products with pagination and filters
router.get('/products', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Build query
        const query = {};
        
        // Search
        if (req.query.search) {
            query.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { brand: { $regex: req.query.search, $options: 'i' } },
                { sku: { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        // Filter by status
        if (req.query.status === 'active') {
            query.isActive = true;
        } else if (req.query.status === 'inactive') {
            query.isActive = false;
        }
        
        // Filter by category
        if (req.query.category) {
            query.category = req.query.category;
        }
        
        // Filter by stock
        if (req.query.stock === 'low') {
            query.stock = { $lte: 10 };
        } else if (req.query.stock === 'out') {
            query.stock = 0;
        }
        
        // Filter by featured
        if (req.query.featured) {
            query.isFeatured = req.query.featured === 'true';
        }
        
        const products = await Product.find(query)
            .populate('category', 'name slug')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const total = await Product.countDocuments(query);
        
        res.json({
            success: true,
            products,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Get admin products error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/products/:id - Get single product
router.get('/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('category', 'name slug')
            .populate('subcategory', 'name slug');
        
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        res.json({ success: true, product });
    } catch (error) {
        console.error('Get admin product error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads/products';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|webp|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// POST /api/admin/products - Create new product
router.post('/products', upload.array('images', 5), async (req, res) => {
    try {
        const {
            name,
            category,
            brand,
            description,
            price,
            discountPrice,
            stock,
            sku,
            colors,
            sizes,
            features,
            specifications,
            isFeatured,
            isActive
        } = req.body;
        
        // Handle uploaded images
        const images = req.files ? req.files.map(file => 
            '/uploads/products/' + file.filename
        ) : [];
        
        if (images.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'At least one product image is required' 
            });
        }
        
        // Parse specifications if provided
        let specObject = {};
        if (specifications) {
            try {
                specObject = JSON.parse(specifications);
            } catch (e) {
                console.error('Error parsing specifications:', e);
            }
        }
        
        // Parse arrays
        const featuresArray = features ? 
            (Array.isArray(features) ? features : features.split(',').map(f => f.trim()).filter(f => f)) 
            : [];
        
        const colorsArray = colors ? 
            (Array.isArray(colors) ? colors : colors.split(',').map(c => c.trim()).filter(c => c))
            : [];
        
        const sizesArray = sizes ? 
            (Array.isArray(sizes) ? sizes : sizes.split(',').map(s => s.trim()).filter(s => s))
            : [];
        
        // Generate slug
        const slug = name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        
        // Create product
        const productData = {
            name,
            slug,
            description,
            brand,
            category,
            price: parseFloat(price),
            stock: parseInt(stock),
            sku: sku || `SKU-${Date.now()}`,
            colors: colorsArray,
            sizes: sizesArray,
            features: featuresArray,
            specifications: specObject,
            images,
            isFeatured: isFeatured === 'true' || isFeatured === true,
            isActive: isActive !== 'false' // Default to true
        };
        
        // Add discount price if provided
        if (discountPrice && discountPrice > 0) {
            productData.discountPrice = parseFloat(discountPrice);
            productData.discountPercentage = Math.round(
                ((price - discountPrice) / price) * 100
            );
        }
        
        const product = new Product(productData);
        await product.save();
        
        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            product
        });
    } catch (error) {
        console.error('Create product error:', error);
        
        // Clean up uploaded files if error occurred
        if (req.files) {
            req.files.forEach(file => {
                fs.unlinkSync(file.path);
            });
        }
        
        // Handle duplicate slug
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                message: 'Product with this name already exists' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create product' 
        });
    }
});

// PUT /api/admin/products/:id - Update product
router.put('/products/:id', upload.array('newImages', 5), async (req, res) => {
    try {
        const productId = req.params.id;
        const {
            name,
            category,
            brand,
            description,
            price,
            discountPrice,
            stock,
            sku,
            colors,
            sizes,
            features,
            specifications,
            isFeatured,
            isActive,
            keepImages
        } = req.body;
        
        // Get existing product
        const existingProduct = await Product.findById(productId);
        if (!existingProduct) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        // Handle images
        const keptImages = keepImages ? 
            (Array.isArray(keepImages) ? keepImages : JSON.parse(keepImages)) 
            : [];
        
        const newImages = req.files ? req.files.map(file => 
            '/uploads/products/' + file.filename
        ) : [];
        
        const allImages = [...keptImages, ...newImages];
        
        if (allImages.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'At least one product image is required' 
            });
        }
        
        // Parse specifications if provided
        let specObject = existingProduct.specifications;
        if (specifications) {
            try {
                specObject = JSON.parse(specifications);
            } catch (e) {
                console.error('Error parsing specifications:', e);
            }
        }
        
        // Parse arrays
        const featuresArray = features ? 
            (Array.isArray(features) ? features : features.split(',').map(f => f.trim()).filter(f => f)) 
            : existingProduct.features;
        
        const colorsArray = colors ? 
            (Array.isArray(colors) ? colors : colors.split(',').map(c => c.trim()).filter(c => c))
            : existingProduct.colors;
        
        const sizesArray = sizes ? 
            (Array.isArray(sizes) ? sizes : sizes.split(',').map(s => s.trim()).filter(s => s))
            : existingProduct.sizes;
        
        // Update product data
        const updateData = {
            name,
            description,
            brand,
            category,
            price: parseFloat(price),
            stock: parseInt(stock),
            sku,
            colors: colorsArray,
            sizes: sizesArray,
            features: featuresArray,
            specifications: specObject,
            images: allImages,
            isFeatured: isFeatured === 'true' || isFeatured === true,
            isActive: isActive !== 'false',
            updatedAt: new Date()
        };
        
        // Update slug if name changed
        if (name !== existingProduct.name) {
            const slug = name.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');
            updateData.slug = slug;
        }
        
        // Add discount price if provided
        if (discountPrice && discountPrice > 0) {
            updateData.discountPrice = parseFloat(discountPrice);
            updateData.discountPercentage = Math.round(
                ((price - discountPrice) / price) * 100
            );
        } else {
            updateData.discountPrice = undefined;
            updateData.discountPercentage = undefined;
        }
        
        const updatedProduct = await Product.findByIdAndUpdate(
            productId, 
            updateData, 
            { new: true }
        ).populate('category', 'name slug');
        
        res.json({
            success: true,
            message: 'Product updated successfully',
            product: updatedProduct
        });
    } catch (error) {
        console.error('Update product error:', error);
        
        // Clean up uploaded files if error occurred
        if (req.files) {
            req.files.forEach(file => {
                fs.unlinkSync(file.path);
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update product' 
        });
    }
});

// PATCH /api/admin/products/:id/toggle - Toggle product status
router.patch('/products/:id/toggle', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        product.isActive = !product.isActive;
        await product.save();
        
        res.json({
            success: true,
            message: `Product ${product.isActive ? 'activated' : 'deactivated'} successfully`,
            product
        });
    } catch (error) {
        console.error('Toggle product error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PATCH /api/admin/products/:id/featured - Toggle featured status
router.patch('/products/:id/featured', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        product.isFeatured = !product.isFeatured;
        await product.save();
        
        res.json({
            success: true,
            message: `Product ${product.isFeatured ? 'added to' : 'removed from'} featured`,
            product
        });
    } catch (error) {
        console.error('Toggle featured error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/admin/products/:id - Delete product
router.delete('/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        // Delete product images from filesystem
        product.images.forEach(image => {
            const imagePath = path.join(__dirname, '..', 'public', image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        });
        
        await Product.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Product deleted successfully'
        });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/products/bulk-delete - Bulk delete products
router.post('/products/bulk-delete', async (req, res) => {
    try {
        const { productIds } = req.body;
        
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Product IDs are required' 
            });
        }
        
        // Get products to delete their images
        const products = await Product.find({ _id: { $in: productIds } });
        
        // Delete images from filesystem
        products.forEach(product => {
            product.images.forEach(image => {
                const imagePath = path.join(__dirname, '..', 'public', image);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            });
        });
        
        // Delete products from database
        await Product.deleteMany({ _id: { $in: productIds } });
        
        res.json({
            success: true,
            message: `${productIds.length} products deleted successfully`
        });
    } catch (error) {
        console.error('Bulk delete products error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== ORDER ROUTES ==========

// GET /api/admin/orders - Get all orders with pagination
router.get('/orders', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Build query
        const query = {};
        
        // Filter by status
        if (req.query.status && req.query.status !== 'all') {
            query.status = req.query.status;
        }
        
        // Filter by payment status
        if (req.query.paymentStatus && req.query.paymentStatus !== 'all') {
            query.paymentStatus = req.query.paymentStatus;
        }
        
        // Search
        if (req.query.search) {
            query.$or = [
                { orderId: { $regex: req.query.search, $options: 'i' } },
                { 'user.name': { $regex: req.query.search, $options: 'i' } },
                { 'user.email': { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        // Date range filter
        if (req.query.startDate && req.query.endDate) {
            query.createdAt = {
                $gte: new Date(req.query.startDate),
                $lte: new Date(req.query.endDate)
            };
        }
        
        const orders = await Order.find(query)
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const total = await Order.countDocuments(query);
        
        // Calculate statistics
        const totalSalesAgg = await Order.aggregate([
            { $match: { paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalSales = totalSalesAgg.length > 0 ? totalSalesAgg[0].total : 0;
        
        const completedOrders = await Order.countDocuments({ status: 'delivered' });
        const pendingOrders = await Order.countDocuments({ status: 'pending' });
        const processingOrders = await Order.countDocuments({ status: 'processing' });
        const cancelledOrders = await Order.countDocuments({ status: 'cancelled' });
        
        res.json({
            success: true,
            orders,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            stats: {
                totalSales,
                totalOrders: total,
                completedOrders,
                pendingOrders,
                processingOrders,
                cancelledOrders
            }
        });
    } catch (error) {
        console.error('Get admin orders error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/orders/:orderId - Get single order
router.get('/orders/:orderId', async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.orderId })
            .populate('user', 'name email phone')
            .populate('items.product', 'name images price slug');
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }
        
        res.json({ success: true, order });
    } catch (error) {
        console.error('Get admin order error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/admin/orders/:orderId/status - Update order status
router.put('/orders/:orderId/status', async (req, res) => {
    try {
        const { status, paymentStatus, notes } = req.body;
        
        const updateData = {};
        if (status) updateData.status = status;
        if (paymentStatus) updateData.paymentStatus = paymentStatus;
        if (notes) updateData.adminNotes = notes;
        
        // Set timestamps based on status
        if (status === 'processing') {
            updateData.processingAt = new Date();
        }
        if (status === 'shipped') {
            updateData.shippedAt = new Date();
        }
        if (status === 'delivered') {
            updateData.deliveredAt = new Date();
        }
        if (status === 'cancelled') {
            updateData.cancelledAt = new Date();
        }
        
        const order = await Order.findOneAndUpdate(
            { orderId: req.params.orderId },
            updateData,
            { new: true }
        ).populate('user', 'name email');
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }
        
        res.json({
            success: true,
            message: 'Order status updated successfully',
            order
        });
    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/orders/:orderId/tracking - Add tracking info
router.post('/orders/:orderId/tracking', async (req, res) => {
    try {
        const { trackingNumber, carrier, trackingUrl } = req.body;
        
        if (!trackingNumber) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tracking number is required' 
            });
        }
        
        const order = await Order.findOneAndUpdate(
            { orderId: req.params.orderId },
            {
                trackingNumber,
                carrier,
                trackingUrl,
                status: 'shipped',
                shippedAt: new Date()
            },
            { new: true }
        );
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }
        
        res.json({
            success: true,
            message: 'Tracking information added',
            order
        });
    } catch (error) {
        console.error('Add tracking error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/admin/orders/:orderId - Delete order
router.delete('/orders/:orderId', async (req, res) => {
    try {
        const order = await Order.findOneAndDelete({ orderId: req.params.orderId });
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }
        
        res.json({
            success: true,
            message: 'Order deleted successfully'
        });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/orders/stats - Get order statistics
router.get('/orders/stats', async (req, res) => {
    try {
        // Get sales statistics
        const totalSalesAgg = await Order.aggregate([
            { $match: { paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        
        // Get order counts
        const totalOrders = await Order.countDocuments();
        const completedOrders = await Order.countDocuments({ status: 'delivered' });
        const pendingOrders = await Order.countDocuments({ status: 'pending' });
        const processingOrders = await Order.countDocuments({ status: 'processing' });
        const cancelledOrders = await Order.countDocuments({ status: 'cancelled' });
        
        // Recent orders for dashboard
        const recentOrders = await Order.find()
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .limit(10);
        
        // Daily sales for last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const dailySales = await Order.aggregate([
            {
                $match: {
                    paymentStatus: 'completed',
                    createdAt: { $gte: sevenDaysAgo }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    total: { $sum: '$totalAmount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        
        res.json({
            success: true,
            stats: {
                totalSales: totalSalesAgg.length > 0 ? totalSalesAgg[0].total : 0,
                totalOrders,
                completedOrders,
                pendingOrders,
                processingOrders,
                cancelledOrders
            },
            recentOrders,
            dailySales
        });
    } catch (error) {
        console.error('Get order stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== CATEGORY ROUTES ==========

// GET /api/admin/categories - Get all categories
router.get('/categories', async (req, res) => {
    try {
        const categories = await Category.find()
            .populate('parent', 'name')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/categories/:id - Get single category
router.get('/categories/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id)
            .populate('parent', 'name');
        
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }
        
        res.json({ success: true, category });
    } catch (error) {
        console.error('Get category error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/categories - Create category
router.post('/categories', async (req, res) => {
    try {
        const { name, description, parent, isActive = true } = req.body;
        
        if (!name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Category name is required' 
            });
        }
        
        // Generate slug
        const slug = name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        
        // Check if category already exists
        const existingCategory = await Category.findOne({ slug });
        if (existingCategory) {
            return res.status(400).json({ 
                success: false, 
                message: 'Category with this name already exists' 
            });
        }
        
        const category = new Category({
            name,
            slug,
            description: description || '',
            parent: parent || null,
            isActive
        });
        
        await category.save();
        
        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            category
        });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/admin/categories/:id - Update category
router.put('/categories/:id', async (req, res) => {
    try {
        const { name, description, parent, isActive } = req.body;
        
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }
        
        // Generate new slug if name changed
        let slug = category.slug;
        if (name && name !== category.name) {
            slug = name.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');
            
            // Check if new slug already exists
            const existingCategory = await Category.findOne({ 
                slug, 
                _id: { $ne: req.params.id } 
            });
            if (existingCategory) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Category with this name already exists' 
                });
            }
        }
        
        // Prevent self-parenting
        let parentId = parent;
        if (parentId === req.params.id) {
            parentId = null;
        }
        
        const updatedCategory = await Category.findByIdAndUpdate(
            req.params.id,
            {
                name: name || category.name,
                slug,
                description: description || category.description,
                parent: parentId,
                isActive: isActive !== undefined ? isActive : category.isActive,
                updatedAt: new Date()
            },
            { new: true }
        ).populate('parent', 'name');
        
        res.json({
            success: true,
            message: 'Category updated successfully',
            category: updatedCategory
        });
    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PATCH /api/admin/categories/:id/toggle - Toggle category status
router.patch('/categories/:id/toggle', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }
        
        category.isActive = !category.isActive;
        await category.save();
        
        res.json({
            success: true,
            message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
            category
        });
    } catch (error) {
        console.error('Toggle category error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/admin/categories/:id - Delete category
router.delete('/categories/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }
        
        // Check if category has products
        const productsCount = await Product.countDocuments({ category: req.params.id });
        if (productsCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete category with ${productsCount} products. Reassign products first.` 
            });
        }
        
        // Check if category has subcategories
        const subcategoriesCount = await Category.countDocuments({ parent: req.params.id });
        if (subcategoriesCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete category with ${subcategoriesCount} subcategories. Delete subcategories first.` 
            });
        }
        
        await Category.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Category deleted successfully'
        });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== CUSTOMER ROUTES ==========

// GET /api/admin/customers - Get all customers
router.get('/customers', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Build query for customers (non-admin users)
        const query = { role: 'user' };
        
        // Search
        if (req.query.search) {
            query.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { email: { $regex: req.query.search, $options: 'i' } },
                { phone: { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        // Filter by status
        if (req.query.status === 'active') {
            query.isActive = true;
        } else if (req.query.status === 'inactive') {
            query.isActive = false;
        }
        
        const customers = await User.find(query)
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const total = await User.countDocuments(query);
        
        res.json({
            success: true,
            customers,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/customers/:id - Get single customer with orders
router.get('/customers/:id', async (req, res) => {
    try {
        const customer = await User.findById(req.params.id)
            .select('-password');
        
        if (!customer) {
            return res.status(404).json({ 
                success: false, 
                message: 'Customer not found' 
            });
        }
        
        // Get customer's orders
        const orders = await Order.find({ user: req.params.id })
            .sort({ createdAt: -1 })
            .limit(20);
        
        // Get customer's total spending
        const totalSpentAgg = await Order.aggregate([
            { $match: { user: customer._id, paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalSpent = totalSpentAgg.length > 0 ? totalSpentAgg[0].total : 0;
        
        res.json({
            success: true,
            customer,
            orders,
            stats: {
                totalOrders: orders.length,
                totalSpent
            }
        });
    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PATCH /api/admin/customers/:id/toggle - Toggle customer status
router.patch('/customers/:id/toggle', async (req, res) => {
    try {
        const customer = await User.findById(req.params.id);
        if (!customer) {
            return res.status(404).json({ 
                success: false, 
                message: 'Customer not found' 
            });
        }
        
        customer.isActive = !customer.isActive;
        await customer.save();
        
        res.json({
            success: true,
            message: `Customer ${customer.isActive ? 'activated' : 'deactivated'} successfully`,
            customer
        });
    } catch (error) {
        console.error('Toggle customer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/admin/customers/:id - Update customer
router.put('/customers/:id', async (req, res) => {
    try {
        const { name, email, phone, address } = req.body;
        
        const customer = await User.findById(req.params.id);
        if (!customer) {
            return res.status(404).json({ 
                success: false, 
                message: 'Customer not found' 
            });
        }
        
        // Check if email already exists (if changing email)
        if (email && email !== customer.email) {
            const existingUser = await User.findOne({ email, _id: { $ne: req.params.id } });
            if (existingUser) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Email already exists' 
                });
            }
        }
        
        const updateData = {
            name: name || customer.name,
            email: email || customer.email,
            phone: phone || customer.phone,
            updatedAt: new Date()
        };
        
        if (address) {
            updateData.address = address;
        }
        
        const updatedCustomer = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        ).select('-password');
        
        res.json({
            success: true,
            message: 'Customer updated successfully',
            customer: updatedCustomer
        });
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/admin/customers/:id - Delete customer
router.delete('/customers/:id', async (req, res) => {
    try {
        const customer = await User.findById(req.params.id);
        if (!customer) {
            return res.status(404).json({ 
                success: false, 
                message: 'Customer not found' 
            });
        }
        
        // Check if customer has orders
        const ordersCount = await Order.countDocuments({ user: req.params.id });
        if (ordersCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete customer with ${ordersCount} orders. Delete orders first.` 
            });
        }
        
        await User.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Customer deleted successfully'
        });
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== REVIEW ROUTES ==========

// GET /api/admin/reviews - Get all reviews
router.get('/reviews', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const query = {};
        
        // Filter by rating
        if (req.query.rating) {
            query.rating = parseInt(req.query.rating);
        }
        
        // Filter by product
        if (req.query.productId) {
            query.product = req.query.productId;
        }
        
        // Filter by status (if you have an isApproved field)
        if (req.query.status === 'pending') {
            query.isApproved = false;
        } else if (req.query.status === 'approved') {
            query.isApproved = true;
        }
        
        const reviews = await Review.find(query)
            .populate('user', 'name email')
            .populate('product', 'name slug')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const total = await Review.countDocuments(query);
        
        res.json({
            success: true,
            reviews,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Get reviews error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PATCH /api/admin/reviews/:id/approve - Approve/reject review
router.patch('/reviews/:id/approve', async (req, res) => {
    try {
        const { isApproved, rejectionReason } = req.body;
        
        const review = await Review.findById(req.params.id);
        if (!review) {
            return res.status(404).json({ 
                success: false, 
                message: 'Review not found' 
            });
        }
        
        const updateData = {
            isApproved: isApproved === true,
            updatedAt: new Date()
        };
        
        if (!isApproved && rejectionReason) {
            updateData.rejectionReason = rejectionReason;
        }
        
        const updatedReview = await Review.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        )
        .populate('user', 'name email')
        .populate('product', 'name slug');
        
        res.json({
            success: true,
            message: `Review ${isApproved ? 'approved' : 'rejected'} successfully`,
            review: updatedReview
        });
    } catch (error) {
        console.error('Approve review error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/admin/reviews/:id - Delete review
router.delete('/reviews/:id', async (req, res) => {
    try {
        const review = await Review.findById(req.params.id);
        if (!review) {
            return res.status(404).json({ 
                success: false, 
                message: 'Review not found' 
            });
        }
        
        await Review.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Review deleted successfully'
        });
    } catch (error) {
        console.error('Delete review error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== CHAT ROUTES ==========
// GET /api/admin/chat/users - Get all users who have chatted with online status
router.get('/chat/users', async (req, res) => {
    try {
        // Get distinct users who have sent messages to admin
        const distinctUsers = await Chat.aggregate([
            {
                $match: {
                    $or: [
                        { receiver: 'admin' },
                        { sender: 'admin' }
                    ]
                }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$sender', 'admin'] },
                            '$receiver',
                            '$sender'
                        ]
                    },
                    lastMessage: { $max: '$createdAt' },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $ne: ['$sender', 'admin'] },
                                        { $eq: ['$isRead', false] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    lastMessageText: { 
                        $last: {
                            $cond: [
                                { $eq: ['$createdAt', { $max: '$createdAt' }] },
                                '$message',
                                null
                            ]
                        }
                    },
                    hasProductInquiry: {
                        $max: {
                            $cond: [
                                { $or: [
                                    { $eq: ['$messageType', 'product_inquiry'] },
                                    { $regexMatch: { 
                                        input: '$message', 
                                        regex: /product inquiry/i 
                                    }}
                                ]},
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { lastMessage: -1 } }
        ]);

        // Get user details for each user ID
        const users = await Promise.all(
            distinctUsers.map(async (item) => {
                const user = await User.findById(item._id).select('name email avatar lastLogin');
                return {
                    userId: item._id,
                    name: user ? user.name : `User ${item._id.substring(0, 8)}`,
                    email: user ? user.email : '',
                    avatar: user ? user.avatar : null,
                    lastMessageTime: item.lastMessage,
                    lastMessageText: item.lastMessageText ? 
                        (item.lastMessageText.length > 50 ? 
                         item.lastMessageText.substring(0, 50) + '...' : 
                         item.lastMessageText) : 'No messages',
                    unreadCount: item.unreadCount,
                    isOnline: user ? (user.lastLogin && 
                        (Date.now() - new Date(user.lastLogin).getTime()) < 300000) : false, // 5 minutes threshold
                    lastActive: user ? user.lastLogin : null,
                    hasProductInquiry: item.hasProductInquiry === 1
                };
            })
        );

        // Filter out admin and sort by online status and unread messages
        const filteredUsers = users
            .filter(user => user.userId !== 'admin')
            .sort((a, b) => {
                // Sort by: online status first, then unread count, then last message time
                if (a.isOnline !== b.isOnline) return b.isOnline - a.isOnline;
                if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
                return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
            });

        // Get currently online users from socket (you'll need to pass socket users somehow)
        // This would require accessing socket.io instance from req.app.get('io')
        const io = req.app.get('io');
        let onlineUsers = [];
        if (io) {
            // Get connected users from socket.io
            // This depends on how you store connected users in socket.io
            // You might need to maintain a separate map in your socket.io setup
        }

        res.json({ 
            success: true, 
            users: filteredUsers,
            stats: {
                total: filteredUsers.length,
                online: filteredUsers.filter(u => u.isOnline).length,
                unread: filteredUsers.reduce((sum, user) => sum + user.unreadCount, 0),
                withInquiries: filteredUsers.filter(u => u.hasProductInquiry).length
            }
        });
    } catch (error) {
        console.error('Get chat users error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// GET /api/admin/chat/users/online - Get currently online users
router.get('/chat/users/online', async (req, res) => {
    try {
        // This would require access to socket.io connected users
        // You need to pass the connected users from your socket.io setup
        const io = req.app.get('io');
        
        if (!io) {
            return res.json({ success: true, users: [], count: 0 });
        }
        
        // Get connected users (this depends on your socket.io implementation)
        // Assuming you have a way to get connected users
        const connectedUsers = []; // You need to implement this
        
        res.json({ 
            success: true, 
            users: connectedUsers,
            count: connectedUsers.length 
        });
    } catch (error) {
        console.error('Get online users error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/chat/messages/:userId - Get chat messages with specific user
router.get('/chat/messages/:userId', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        
        const messages = await Chat.find({
            $or: [
                { sender: req.params.userId, receiver: 'admin' },
                { sender: 'admin', receiver: req.params.userId }
            ]
        })
        .sort({ createdAt: -1 })
        .skip(parseInt(offset))
        .limit(parseInt(limit))
        .lean(); // Use lean() for better performance

        // Mark user messages as read
        await Chat.updateMany(
            {
                sender: req.params.userId,
                receiver: 'admin',
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date()
            }
        );

        // Get user details
        const user = await User.findById(req.params.userId).select('name email avatar');
        
        // Get user's recent product inquiries
        const productInquiries = await Chat.find({
            sender: req.params.userId,
            receiver: 'admin',
            messageType: 'product_inquiry'
        })
        .sort({ createdAt: -1 })
        .limit(5);

        res.json({ 
            success: true, 
            messages: messages.reverse(), // Return in chronological order
            user: {
                userId: req.params.userId,
                name: user ? user.name : `User ${req.params.userId.substring(0, 8)}`,
                email: user ? user.email : '',
                avatar: user ? user.avatar : null
            },
            stats: {
                totalMessages: messages.length,
                unreadBefore: messages.filter(m => !m.isRead && m.sender === req.params.userId).length,
                productInquiries: productInquiries.length
            }
        });
    } catch (error) {
        console.error('Get chat messages error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// GET /api/admin/chat/messages/:userId/product-inquiries - Get product inquiries from user
router.get('/chat/messages/:userId/product-inquiries', async (req, res) => {
    try {
        const inquiries = await Chat.find({
            sender: req.params.userId,
            receiver: 'admin',
            $or: [
                { messageType: 'product_inquiry' },
                { 'metadata.type': 'product_inquiry' },
                { message: { $regex: /product inquiry/i } }
            ]
        })
        .sort({ createdAt: -1 })
        .lean();

        // Enrich with product details if productId exists in metadata
        const enrichedInquiries = await Promise.all(
            inquiries.map(async (inquiry) => {
                if (inquiry.metadata && inquiry.metadata.productId) {
                    const product = await Product.findById(inquiry.metadata.productId)
                        .select('name price image stock');
                    return {
                        ...inquiry,
                        product: product || null
                    };
                }
                return inquiry;
            })
        );

        res.json({ 
            success: true, 
            inquiries: enrichedInquiries 
        });
    } catch (error) {
        console.error('Get product inquiries error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/chat/messages - Send message as admin
router.post('/chat/messages', async (req, res) => {
    try {
        const { userId, message, messageType = 'text', metadata } = req.body;
        
        if (!userId || !message || message.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID and message are required' 
            });
        }
        
        // Verify user exists
        const userExists = await User.exists({ _id: userId });
        if (!userExists && userId !== 'admin') {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        const chat = new Chat({
            sender: 'admin',
            receiver: userId,
            message: message.trim(),
            messageType: messageType,
            metadata: metadata,
            isRead: false
        });
        
        await chat.save();
        
        // Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.to(`user:${userId}`).emit('receiveMessage', {
                _id: chat._id.toString(),
                sender: 'admin',
                receiver: userId,
                message: chat.message,
                messageType: chat.messageType,
                metadata: chat.metadata,
                isRead: false,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt
            });
        }
        
        res.status(201).json({ 
            success: true,
            message: 'Message sent successfully',
            chat 
        });
    } catch (error) {
        console.error('Send chat error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// POST /api/admin/chat/messages/product-response - Send product inquiry response
router.post('/chat/messages/product-response', async (req, res) => {
    try {
        const { userId, productId, response, inquiryId } = req.body;
        
        if (!userId || !response || response.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID and response are required' 
            });
        }
        
        // Get product details if productId provided
        let productDetails = null;
        if (productId) {
            productDetails = await Product.findById(productId).select('name price');
        }
        
        const chat = new Chat({
            sender: 'admin',
            receiver: userId,
            message: response.trim(),
            messageType: 'product_response',
            metadata: {
                type: 'product_response',
                productId: productId,
                productName: productDetails ? productDetails.name : null,
                originalInquiry: inquiryId
            },
            isRead: false
        });
        
        await chat.save();
        
        // Mark original inquiry as responded if inquiryId provided
        if (inquiryId) {
            await Chat.findByIdAndUpdate(inquiryId, {
                'metadata.responded': true,
                'metadata.responseId': chat._id
            });
        }
        
        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.to(`user:${userId}`).emit('receiveMessage', {
                _id: chat._id.toString(),
                sender: 'admin',
                receiver: userId,
                message: chat.message,
                messageType: 'product_response',
                metadata: chat.metadata,
                isRead: false,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt
            });
        }
        
        res.status(201).json({ 
            success: true,
            message: 'Product response sent successfully',
            chat 
        });
    } catch (error) {
        console.error('Send product response error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/admin/chat/messages/read - Mark messages as read
router.put('/chat/messages/read', async (req, res) => {
    try {
        const { messageIds, userId } = req.body;
        
        if (!messageIds || !Array.isArray(messageIds)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Message IDs array is required' 
            });
        }
        
        const updateResult = await Chat.updateMany(
            {
                _id: { $in: messageIds },
                receiver: 'admin',
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date()
            }
        );
        
        res.json({ 
            success: true,
            message: 'Messages marked as read',
            updatedCount: updateResult.modifiedCount
        });
    } catch (error) {
        console.error('Mark messages as read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/chat/stats - Get chat statistics
router.get('/chat/stats', async (req, res) => {
    try {
        const today = new Date();
        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        
        // Total messages
        const totalMessages = await Chat.countDocuments({
            $or: [
                { sender: 'admin' },
                { receiver: 'admin' }
            ]
        });
        
        // Today's messages
        const todaysMessages = await Chat.countDocuments({
            $or: [
                { sender: 'admin' },
                { receiver: 'admin' }
            ],
            createdAt: { $gte: startOfToday }
        });
        
        // Unread messages
        const unreadMessages = await Chat.countDocuments({
            receiver: 'admin',
            isRead: false
        });
        
        // Active conversations (users who messaged in last 24 hours)
        const activeConversations = await Chat.distinct('sender', {
            receiver: 'admin',
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }).then(users => users.filter(id => id !== 'admin').length);
        
        // Product inquiries count
        const productInquiries = await Chat.countDocuments({
            receiver: 'admin',
            $or: [
                { messageType: 'product_inquiry' },
                { 'metadata.type': 'product_inquiry' }
            ],
            createdAt: { $gte: startOfMonth }
        });
        
        // Response time (average)
        const responseTimes = await Chat.aggregate([
            {
                $match: {
                    receiver: 'admin',
                    sender: { $ne: 'admin' }
                }
            },
            {
                $sort: { createdAt: 1 }
            },
            {
                $group: {
                    _id: '$sender',
                    firstMessage: { $first: '$createdAt' },
                    firstResponse: {
                        $first: {
                            $cond: [
                                { $eq: ['$sender', 'admin'] },
                                '$createdAt',
                                null
                            ]
                        }
                    }
                }
            },
            {
                $match: {
                    firstResponse: { $ne: null }
                }
            },
            {
                $project: {
                    responseTime: {
                        $divide: [
                            { $subtract: ['$firstResponse', '$firstMessage'] },
                            60000 // Convert to minutes
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    avgResponseTime: { $avg: '$responseTime' }
                }
            }
        ]);
        
        res.json({
            success: true,
            stats: {
                totalMessages,
                todaysMessages,
                unreadMessages,
                activeConversations,
                productInquiries,
                avgResponseTime: responseTimes[0] ? Math.round(responseTimes[0].avgResponseTime) : 0,
                responseRate: totalMessages > 0 ? 
                    Math.round((totalMessages - unreadMessages) / totalMessages * 100) : 0
            }
        });
    } catch (error) {
        console.error('Get chat stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/chat/search - Search messages
router.get('/chat/search', async (req, res) => {
    try {
        const { query, userId } = req.query;
        
        if (!query || query.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Search query is required' 
            });
        }
        
        const searchFilter = {
            $or: [
                { sender: 'admin' },
                { receiver: 'admin' }
            ],
            message: { $regex: query, $options: 'i' }
        };
        
        if (userId) {
            searchFilter.$or = [
                { sender: userId, receiver: 'admin' },
                { sender: 'admin', receiver: userId }
            ];
        }
        
        const messages = await Chat.find(searchFilter)
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        
        // Get user details for each unique user
        const userIds = [...new Set(messages.map(m => 
            m.sender === 'admin' ? m.receiver : m.sender
        ))];
        
        const users = await User.find({ _id: { $in: userIds } })
            .select('name email avatar')
            .lean();
        
        const userMap = users.reduce((map, user) => {
            map[user._id.toString()] = user;
            return map;
        }, {});
        
        const enrichedMessages = messages.map(message => {
            const userId = message.sender === 'admin' ? message.receiver : message.sender;
            const user = userMap[userId] || { name: `User ${userId.substring(0, 8)}` };
            
            return {
                ...message,
                user: {
                    userId,
                    name: user.name,
                    email: user.email,
                    avatar: user.avatar
                }
            };
        });
        
        res.json({
            success: true,
            messages: enrichedMessages,
            count: messages.length
        });
    } catch (error) {
        console.error('Search messages error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== ADMIN USER MANAGEMENT ==========

// GET /api/admin/admins - Get all admin users
router.get('/admins', async (req, res) => {
    try {
        const admins = await User.find({ role: 'admin' })
            .select('-password')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, admins });
    } catch (error) {
        console.error('Get admins error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/admins - Create new admin
router.post('/admins', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, email and password are required' 
            });
        }
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'User with this email already exists' 
            });
        }
        
        // Hash password
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const admin = new User({
            name,
            email,
            password: hashedPassword,
            role: 'admin',
            isActive: true
        });
        
        await admin.save();
        
        res.status(201).json({
            success: true,
            message: 'Admin created successfully',
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                isActive: admin.isActive
            }
        });
    } catch (error) {
        console.error('Create admin error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========== SETTINGS/UTILITY ROUTES ==========

// GET /api/admin/settings - Get admin settings
router.get('/settings', async (req, res) => {
    try {
        // This would typically come from a Settings model
        const settings = {
            siteName: 'Noon E-commerce',
            siteDescription: 'Modern e-commerce platform',
            currency: 'USD',
            taxRate: 10,
            shippingFee: 10,
            contactEmail: 'support@noon.com',
            contactPhone: '+1 234 567 8900',
            maintenanceMode: false,
            allowRegistration: true,
            maxProductsPerPage: 20
        };
        
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/admin/settings - Update admin settings
router.put('/settings', async (req, res) => {
    try {
        const settings = req.body;
        
        // In a real app, you would save these to a database
        // For now, we'll just return them
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings
        });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/analytics - Get advanced analytics
router.get('/analytics', async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let startDate;
        const endDate = new Date();
        
        switch (period) {
            case 'week':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case 'quarter':
                startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 3);
                break;
            case 'year':
                startDate = new Date();
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
            default:
                startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 1);
        }
        
        // Sales analytics
        const salesAnalytics = await Order.aggregate([
            {
                $match: {
                    paymentStatus: 'completed',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    totalSales: { $sum: '$totalAmount' },
                    orderCount: { $sum: 1 },
                    avgOrderValue: { $avg: '$totalAmount' }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        
        // Top products
        const topProducts = await Order.aggregate([
            {
                $match: {
                    paymentStatus: 'completed',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.product',
                    productName: { $first: '$items.name' },
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
                }
            },
            { $sort: { totalRevenue: -1 } },
            { $limit: 10 }
        ]);
        
        // Populate product details
        const topProductsWithDetails = await Promise.all(
            topProducts.map(async (item) => {
                const product = await Product.findById(item._id).select('name images');
                return {
                    ...item,
                    product: product
                };
            })
        );
        
        // Customer analytics
        const newCustomers = await User.countDocuments({
            role: 'user',
            createdAt: { $gte: startDate, $lte: endDate }
        });
        
        const returningCustomers = await Order.aggregate([
            {
                $match: {
                    paymentStatus: 'completed',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$user',
                    orderCount: { $sum: 1 }
                }
            },
            {
                $match: {
                    orderCount: { $gt: 1 }
                }
            },
            {
                $count: 'returningCustomers'
            }
        ]);
        
        res.json({
            success: true,
            analytics: {
                period,
                startDate,
                endDate,
                salesAnalytics,
                topProducts: topProductsWithDetails,
                customerStats: {
                    newCustomers,
                    returningCustomers: returningCustomers[0]?.returningCustomers || 0
                }
            }
        });
    } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/backup - Backup database (simplified)
router.post('/backup', async (req, res) => {
    try {
        // In a real app, you would implement database backup logic here
        // This is just a placeholder
        
        const backupInfo = {
            timestamp: new Date().toISOString(),
            status: 'completed',
            message: 'Backup created successfully',
            fileSize: '2.5 MB',
            downloadUrl: '/backups/backup-' + Date.now() + '.json'
        };
        
        res.json({
            success: true,
            message: 'Database backup initiated',
            backup: backupInfo
        });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;