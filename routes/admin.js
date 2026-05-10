const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const User = require('../models/User');
const Review = require('../models/Review');
const userChatRoutes = require('./user-chat');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { isAdmin } = require('../middleware/authMiddleware');

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
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

// Admin authentication middleware
const adminAuth = async (req, res, next) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login first');
            return res.redirect('/login');
        }
        
        const user = await User.findById(req.session.user.id);
        
        if (!user || user.role !== 'admin') {
            req.flash('error', 'Access denied. Admin only.');
            return res.redirect('/');
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
};

// Apply admin auth to all admin routes
router.use(isAdmin);

// ADMIN DASHBOARD
// ============================
router.get('/dashboard', async (req, res) => {
    try {
        console.log('=== ADMIN DASHBOARD ACCESSED ===');
        
        // Get dashboard statistics
         const totalSalesAgg = await Order.aggregate([
            { $match: { paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalSales = totalSalesAgg.length > 0 ? totalSalesAgg[0].total : 0;
        const totalOrders = await Order.countDocuments();
        const totalProducts = await Product.countDocuments();
        const totalCustomers = await User.countDocuments({ role: 'user' });
        
        // Recent orders
        const recentOrders = await Order.find()
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .limit(10);
        
        // Top selling products
        const topProducts = await Order.aggregate([
            { $unwind: '$items' },
            { $group: {
                _id: '$items.product',
                totalSold: { $sum: '$items.quantity' }
            }},
            { $sort: { totalSold: -1 } },
            { $limit: 5 }
        ]);
        
        // Get product details for top products
        const topProductsWithDetails = await Promise.all(
            topProducts.map(async (item) => {
                const product = await Product.findById(item._id);
                return {
                    product: product,
                    totalSold: item.totalSold
                };
            })
        );
        
        // Low stock products
        const lowStockProducts = await Product.find({
            stock: { $lte: 10 },
            isActive: true
        }).limit(5);
        
        // Render with ALL required variables
        res.render('admin/dashboard', {
            layout: 'layouts/admin-layout',
            title: 'Admin Dashboard',
            currentPage: 'dashboard',
            user: req.user || req.session.user,
            totalSales: totalSales[0]?.total || 0,
            totalOrders,
            totalProducts,
            totalCustomers,
            recentOrders,
            topProducts: topProductsWithDetails,
            lowStockProducts,
            error_msg: req.flash('error') || null,
            success_msg: req.flash('success') || null,
            error: null
        });
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.render('admin/dashboard', {
            layout: 'layouts/admin-layout',
            title: 'Admin Dashboard',
            currentPage: 'dashboard',
            user: req.user || req.session.user,
            error_msg: 'Error loading dashboard: ' + error.message,
            success_msg: null,
            error: null,
            totalSales: 0,
            totalOrders: 0,
            totalProducts: 0,
            totalCustomers: 0,
            recentOrders: [],
            topProducts: [],
            lowStockProducts: []
        });
    }
});

// ============================
// PRODUCT MANAGEMENT - CRUD
// ============================
// 1. LIST ALL PRODUCTS
router.get('/products', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        const products = await Product.find()
            .populate('category')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const totalProducts = await Product.countDocuments();
        const totalPages = Math.ceil(totalProducts / limit);
        
        const categories = await Category.find({ isActive: true });
        
        res.render('admin/products/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Products',
            currentPage: 'products',
            user: req.user || req.session.user,
            products,
            categories,
            currentPageNum: page,
            totalPages,
            error_msg: req.flash('error') || null,
            success_msg: req.flash('success') || null,
            error: null
        });
    } catch (error) {
        console.error('Error loading products:', error);
        res.render('admin/products/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Products',
            currentPage: 'products',
            user: req.user || req.session.user,
            products: [],
            categories: [],
            error_msg: 'Error loading products: ' + error.message,
            success_msg: null,
            error: null
        });
    }
});
// 2. SHOW ADD PRODUCT FORM
router.get('/products/new', async (req, res) => {
    try {
        const categories = await Category.find({ isActive: true });
        res.render('admin/products/new', {
            layout: 'layouts/admin-layout',
            title: 'Add New Product',
            currentPage: 'products',
            user: req.user,
            categories,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading new product form:', error);
        req.flash('error', 'Error loading categories');
        res.redirect('/admin/products');
    }
});

// 3. CREATE NEW PRODUCT (with file upload)
router.post('/products/create', upload.array('images', 5), async (req, res) => {
    try {
        const {
            name,
            slug,
            description,
            brand,
            category,
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
        
        // Parse JSON specifications
        let specObject = {};
        if (specifications && specifications.trim()) {
            try {
                specObject = JSON.parse(specifications);
            } catch (e) {
                console.error('Error parsing specifications:', e);
            }
        }
        
        // Parse arrays
        const featuresArray = features ? features.split(',').map(f => f.trim()).filter(f => f) : [];
        const colorsArray = colors ? colors.split(',').map(c => c.trim()).filter(c => c) : [];
        const sizesArray = sizes ? sizes.split(',').map(s => s.trim()).filter(s => s) : [];
        
        // Create product
        const productData = {
            name,
            slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
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
            images,
            isFeatured: isFeatured === 'true',
            isActive: isActive === 'true'
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
        
        req.flash('success', 'Product created successfully');
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error creating product:', error);
        req.flash('error', 'Failed to create product: ' + error.message);
        res.redirect('/admin/products/new');
    }
});

// 4. SHOW EDIT PRODUCT FORM
router.get('/products/:id/edit', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        const categories = await Category.find({ isActive: true });
        
        if (!product) {
            req.flash('error', 'Product not found');
            return res.redirect('/admin/products');
        }
        
        res.render('admin/products/edit', {
            layout: 'layouts/admin-layout',
            title: 'Edit Product',
            currentPage: 'products',
            user: req.user,
            product,
            categories,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading edit form:', error);
        req.flash('error', 'Error loading product');
        res.redirect('/admin/products');
    }
});

// 5. UPDATE PRODUCT (with file upload)
router.post('/products/:id/update', upload.array('newImages', 5), async (req, res) => {
    try {
        const productId = req.params.id;
        const {
            name,
            slug,
            description,
            brand,
            category,
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
            req.flash('error', 'Product not found');
            return res.redirect('/admin/products');
        }
        
        // Handle images
        const keptImages = keepImages ? 
            (Array.isArray(keepImages) ? keepImages : [keepImages]) : 
            [];
        
        const newImages = req.files ? req.files.map(file => 
            '/uploads/products/' + file.filename
        ) : [];
        
        const allImages = [...keptImages, ...newImages];
        
        // Parse JSON specifications
        let specObject = {};
        if (specifications && specifications.trim()) {
            try {
                specObject = JSON.parse(specifications);
            } catch (e) {
                console.error('Error parsing specifications:', e);
                specObject = existingProduct.specifications;
            }
        }
        
        // Parse arrays
        const featuresArray = features ? features.split(',').map(f => f.trim()).filter(f => f) : [];
        const colorsArray = colors ? colors.split(',').map(c => c.trim()).filter(c => c) : [];
        const sizesArray = sizes ? sizes.split(',').map(s => s.trim()).filter(s => s) : [];
        
        // Update product
        const updateData = {
            name,
            slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
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
            isFeatured: isFeatured === 'true',
            isActive: isActive === 'true'
        };
        
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
        
        await Product.findByIdAndUpdate(productId, updateData);
        
        req.flash('success', 'Product updated successfully');
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error updating product:', error);
        req.flash('error', 'Failed to update product: ' + error.message);
        res.redirect(`/admin/products/${req.params.id}/edit`);
    }
});

// 6. TOGGLE PRODUCT STATUS (Active/Inactive)
router.post('/products/:id/toggle', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (product) {
            product.isActive = !product.isActive;
            await product.save();
            req.flash('success', `Product ${product.isActive ? 'activated' : 'deactivated'} successfully`);
        } else {
            req.flash('error', 'Product not found');
        }
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error toggling product status:', error);
        req.flash('error', 'Failed to update product status');
        res.redirect('/admin/products');
    }
});

// 7. DELETE PRODUCT
router.post('/products/:id/delete', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        req.flash('success', 'Product deleted successfully');
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error deleting product:', error);
        req.flash('error', 'Failed to delete product');
        res.redirect('/admin/products');
    }
});
// ============================
// REVIEWS MANAGEMENT
// ============================
router.get('/reviews', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        const reviews = await Review.find()
            .populate('user', 'name email')
            .populate('product', 'name slug')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const totalReviews = await Review.countDocuments();
        const totalPages = Math.ceil(totalReviews / limit);
        
        res.render('admin/reviews/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Reviews',
            currentPage: 'reviews',
            user: req.user || res.locals.user,
            reviews,
            currentPageNum: page,
            totalPages,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading reviews:', error);
        req.flash('error', 'Error loading reviews: ' + error.message);
        res.redirect('/admin/dashboard');
    }
});

// Add these routes for review management
router.post('/reviews/:id/approve', async (req, res) => {
    try {
        await Review.findByIdAndUpdate(req.params.id, { isApproved: true });
        req.flash('success', 'Review approved successfully');
        res.redirect('/admin/reviews');
    } catch (error) {
        console.error('Error approving review:', error);
        req.flash('error', 'Failed to approve review');
        res.redirect('/admin/reviews');
    }
});

router.post('/reviews/:id/disapprove', async (req, res) => {
    try {
        await Review.findByIdAndUpdate(req.params.id, { isApproved: false });
        req.flash('success', 'Review disapproved successfully');
        res.redirect('/admin/reviews');
    } catch (error) {
        console.error('Error disapproving review:', error);
        req.flash('error', 'Failed to disapprove review');
        res.redirect('/admin/reviews');
    }
});

router.post('/reviews/:id/delete', async (req, res) => {
    try {
        await Review.findByIdAndDelete(req.params.id);
        req.flash('success', 'Review deleted successfully');
        res.redirect('/admin/reviews');
    } catch (error) {
        console.error('Error deleting review:', error);
        req.flash('error', 'Failed to delete review');
        res.redirect('/admin/reviews');
    }
});
// ============================
// CATEGORY MANAGEMENT - CRUD
// ============================
// 1. LIST ALL CATEGORIES
router.get('/categories', async (req, res) => {
    try {
        const categories = await Category.find()
            .populate('parent')
            .sort({ createdAt: -1 });
        
        res.render('admin/categories/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Categories',
            currentPage: 'categories',
            user: req.user || req.session.user,
            categories,
            error_msg: req.flash('error') || null,
            success_msg: req.flash('success') || null,
            error: null
        });
    } catch (error) {
        console.error('Error loading categories:', error);
        res.render('admin/categories/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Categories',
            currentPage: 'categories',
            user: req.user || req.session.user,
            categories: [],
            error_msg: 'Error loading categories: ' + error.message,
            success_msg: null,
            error: null
        });
    }
});
// 2. SHOW ADD CATEGORY FORM
router.get('/categories/new', async (req, res) => {
    try {
        const categories = await Category.find({ isActive: true });
        
        res.render('admin/categories/new', {
            layout: 'layouts/admin-layout',
            title: 'Add New Category',
            currentPage: 'categories',
            user: req.user,
            categories,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading new category form:', error);
        req.flash('error', 'Error loading form: ' + error.message);
        res.redirect('/admin/categories');
    }
});

// 3. CREATE NEW CATEGORY
router.post('/categories/create', async (req, res) => {
    try {
        const { name, description, parent } = req.body;
        
        // Validation
        if (!name || name.trim() === '') {
            req.flash('error', 'Category name is required');
            return res.redirect('/admin/categories/new');
        }
        
        const slug = name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        
        // Check if slug already exists
        const existingCategory = await Category.findOne({ slug });
        if (existingCategory) {
            req.flash('error', 'Category with this name already exists');
            return res.redirect('/admin/categories/new');
        }
        
        const category = new Category({
            name: name.trim(),
            slug,
            description: description ? description.trim() : '',
            parent: parent || null,
            isActive: true
        });
        
        await category.save();
        
        req.flash('success', 'Category added successfully');
        res.redirect('/admin/categories');
    } catch (error) {
        console.error('Error creating category:', error);
        req.flash('error', 'Failed to add category: ' + error.message);
        res.redirect('/admin/categories/new');
    }
});

// 4. SHOW EDIT CATEGORY FORM
router.get('/categories/:id/edit', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id).populate('parent');
        if (!category) {
            req.flash('error', 'Category not found');
            return res.redirect('/admin/categories');
        }
        
        const categories = await Category.find({ 
            _id: { $ne: category._id },
            isActive: true 
        });
        
        res.render('admin/categories/edit', {
            layout: 'layouts/admin-layout',
            title: 'Edit Category - ' + category.name,
            currentPage: 'categories',
            user: req.user,
            category,
            categories,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading edit category form:', error);
        req.flash('error', 'Error loading category: ' + error.message);
        res.redirect('/admin/categories');
    }
});

// 5. UPDATE CATEGORY
router.post('/categories/:id/update', async (req, res) => {
    try {
        const { name, description, parent } = req.body;
        
        // Validation
        if (!name || name.trim() === '') {
            req.flash('error', 'Category name is required');
            return res.redirect(`/admin/categories/${req.params.id}/edit`);
        }
        
        // Check if category exists
        const existingCategory = await Category.findById(req.params.id);
        if (!existingCategory) {
            req.flash('error', 'Category not found');
            return res.redirect('/admin/categories');
        }
        
        const slug = name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        
        // Check if new slug conflicts with another category
        const slugConflict = await Category.findOne({
            slug,
            _id: { $ne: req.params.id }
        });
        
        if (slugConflict) {
            req.flash('error', 'Category with this name already exists');
            return res.redirect(`/admin/categories/${req.params.id}/edit`);
        }
        
        // Prevent setting parent to itself
        let parentId = parent || null;
        if (parentId === req.params.id) {
            parentId = null;
            req.flash('warning', 'Category cannot be its own parent');
        }
        
        await Category.findByIdAndUpdate(req.params.id, {
            name: name.trim(),
            slug,
            description: description ? description.trim() : '',
            parent: parentId,
            updatedAt: new Date()
        });
        
        req.flash('success', 'Category updated successfully');
        res.redirect('/admin/categories');
    } catch (error) {
        console.error('Error updating category:', error);
        req.flash('error', 'Failed to update category: ' + error.message);
        res.redirect(`/admin/categories/${req.params.id}/edit`);
    }
});

// 6. TOGGLE CATEGORY STATUS
router.post('/categories/:id/toggle', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (category) {
            category.isActive = !category.isActive;
            await category.save();
            req.flash('success', `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`);
        }
        res.redirect('/admin/categories');
    } catch (error) {
        console.error('Error toggling category:', error);
        req.flash('error', 'Failed to update category status');
        res.redirect('/admin/categories');
    }
});

// 7. DELETE CATEGORY
router.post('/categories/:id/delete', async (req, res) => {
    try {
        // Check if category has products
        const productsCount = await Product.countDocuments({ category: req.params.id });
        
        if (productsCount > 0) {
            req.flash('error', `Cannot delete category with ${productsCount} products. Reassign products first.`);
            return res.redirect('/admin/categories');
        }
        
        await Category.findByIdAndDelete(req.params.id);
        req.flash('success', 'Category deleted successfully');
        res.redirect('/admin/categories');
    } catch (error) {
        console.error('Error deleting category:', error);
        req.flash('error', 'Failed to delete category');
        res.redirect('/admin/categories');
    }
});

// ============================
// CUSTOMER MANAGEMENT
// ============================
router.get('/customers', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        const customers = await User.find({ role: 'user' })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const totalCustomers = await User.countDocuments({ role: 'user' });
        const totalPages = Math.ceil(totalCustomers / limit);
        
        res.render('admin/customers/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Customers',
            currentPage: 'customers',
            user: req.user,
            customers,
            currentPageNum: page,
            totalPages,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Error loading customers');
        res.redirect('/admin/dashboard');
    }
});

router.get('/customers/:id', async (req, res) => {
    try {
        const customer = await User.findById(req.params.id);
        const orders = await Order.find({ user: req.params.id }).sort({ createdAt: -1 });
        
        if (!customer) {
            req.flash('error', 'Customer not found');
            return res.redirect('/admin/customers');
        }
        
        res.render('admin/customers/detail', {
            layout: 'layouts/admin-layout',
            title: 'Customer Details',
            currentPage: 'customers',
            user: req.user,
            customer,
            orders,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Error loading customer');
        res.redirect('/admin/customers');
    }
});

router.post('/customers/:id/toggle', async (req, res) => {
    try {
        const customer = await User.findById(req.params.id);
        if (customer) {
            customer.isActive = !customer.isActive;
            await customer.save();
            req.flash('success', `Customer ${customer.isActive ? 'activated' : 'deactivated'} successfully`);
        }
        res.redirect('/admin/customers');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update customer status');
        res.redirect('/admin/customers');
    }
});

// ============================
// REVIEWS MANAGEMENT
// ============================
router.get('/reviews', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        const reviews = await Review.find()
            .populate('user', 'name')
            .populate('product', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const totalReviews = await Review.countDocuments();
        const totalPages = Math.ceil(totalReviews / limit);
        
        res.render('admin/reviews/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Reviews',
            currentPage: 'reviews',
            user: req.user,
            reviews,
            currentPageNum: page,
            totalPages,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Error loading reviews');
        res.redirect('/admin/dashboard');
    }
});

router.post('/reviews/:id/delete', async (req, res) => {
    try {
        await Review.findByIdAndDelete(req.params.id);
        req.flash('success', 'Review deleted successfully');
        res.redirect('/admin/reviews');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to delete review');
        res.redirect('/admin/reviews');
    }
});
router.get('/chat', (req, res) => {
    res.render('admin/chat', {
        layout: 'layouts/admin-layout',
        title: 'Admin Chat',
        currentPage: 'chat',
        user: req.user
    });
});

module.exports = router;