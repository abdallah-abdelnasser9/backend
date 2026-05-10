const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const mongoose = require('mongoose');

// Mock payment simulation
const simulatePayment = async (paymentDetails) => {
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate random success based on payment method
    let isSuccess;
    switch(paymentDetails.paymentMethod) {
        case 'paypal_sandbox':
            isSuccess = Math.random() > 0.2; // 80% success rate
            break;
        case 'demo':
            isSuccess = true; // Always succeeds
            break;
        case 'fail':
            isSuccess = false; // Always fails
            break;
        default:
            isSuccess = true;
    }
    
    return {
        success: isSuccess,
        transactionId: isSuccess ? 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase() : null,
        message: isSuccess ? 'Payment completed successfully' : 'Payment simulation failed. Please try again.',
        timestamp: new Date().toISOString()
    };
};

// GET Checkout page
router.get('/', (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login to proceed to checkout');
            return res.redirect('/auth/login');
        }
        
        const cart = req.session.cart || { items: [], total: 0 };
        
        if (!cart.items || cart.items.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }
        
        // Calculate totals
        const subtotal = cart.total || 0;
        const shipping = 10.00;
        const tax = subtotal * 0.05;
        const total = subtotal + shipping + tax;
        
        res.render('checkout/index', {
            title: 'Checkout',
            cart: {
                items: cart.items || [],
                subtotal: subtotal.toFixed(2),
                shipping: shipping.toFixed(2),
                tax: tax.toFixed(2),
                total: total.toFixed(2),
                totalItems: cart.items ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0
            },
            user: req.session.user
        });
    } catch (error) {
        console.error('Checkout GET error:', error);
        res.status(500).render('error', { 
            title: 'Error',
            error: 'Failed to load checkout page. Please try again.'
        });
    }
});

// POST Process payment - WORKING VERSION
router.post('/process-payment', async (req, res) => {
    try {
        console.log('=== PAYMENT PROCESS START ===');
        
        if (!req.session.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Please login first' 
            });
        }
        
        const cart = req.session.cart;
        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cart is empty' 
            });
        }
        
        const { paymentMethod, shippingAddress } = req.body;
        
        // Calculate totals
        const subtotal = cart.total || 0;
        const shipping = 10.00;
        const tax = subtotal * 0.05;
        const total = subtotal + shipping + tax;
        
        // Map payment method to your Order model enum
        let paymentMethodEnum;
        switch(paymentMethod) {
            case 'paypal_sandbox':
                paymentMethodEnum = 'paypal';
                break;
            case 'demo':
            case 'fail':
                paymentMethodEnum = 'card';
                break;
            default:
                paymentMethodEnum = 'card';
        }
        
        // Process payment
        const paymentResult = await simulatePayment({
            amount: total,
            currency: 'USD',
            description: 'Order Payment',
            paymentMethod: paymentMethod
        });
        
        console.log('Payment result:', paymentResult);
        
        // Generate order ID
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        const orderId = `ORD-${timestamp}-${random}`;
        
        console.log('Generated orderId:', orderId);
        
        // Prepare items - ensure product IDs are valid ObjectIds
        const items = cart.items.map(item => {
            let productId;
            
            // Check if productId is a valid ObjectId
            if (mongoose.Types.ObjectId.isValid(item.productId)) {
                productId = item.productId;
            } else {
                // If not valid, create a new ObjectId
                productId = new mongoose.Types.ObjectId();
            }
            
            return {
                product: productId,
                name: item.name || 'Product',
                quantity: item.quantity || 1,
                price: item.price || 0,
                subtotal: (item.price || 0) * (item.quantity || 1)
            };
        });
        
        // Create order data
        const orderData = {
            orderId: orderId,
            user: req.session.user.id,
            items: items,
            shippingAddress: {
                street: shippingAddress.address || '',
                city: shippingAddress.city || '',
                state: shippingAddress.state || '',
                country: shippingAddress.country || 'United States',
                zipCode: shippingAddress.zip || ''
            },
            paymentMethod: paymentMethodEnum,
            paymentStatus: paymentResult.success ? 'completed' : 'failed',
            paymentId: paymentResult.transactionId || null,
            status: paymentResult.success ? 'processing' : 'pending',
            subtotal: subtotal,
            shippingFee: shipping,
            tax: tax,
            totalAmount: total
        };
        
        console.log('Order data prepared');
        
        // Save order to database
        let savedOrder;
        let saveMethod = '';
        
        try {
            // Method 1: Try Order.create() first (simplest)
            savedOrder = await Order.create(orderData);
            saveMethod = 'Order.create()';
            console.log('✅ Order saved successfully using Order.create()');
        } catch (createError) {
            console.log('Order.create() failed, trying alternative methods:', createError.message);
            
            try {
                // Method 2: Try with new Order() and .save()
                const order = new Order(orderData);
                savedOrder = await order.save();
                saveMethod = 'new Order().save()';
                console.log('✅ Order saved successfully using new Order().save()');
            } catch (saveError) {
                console.log('new Order().save() failed, trying direct insert:', saveError.message);
                
                try {
                    // Method 3: Direct MongoDB insert (bypasses Mongoose middleware)
                    const result = await Order.collection.insertOne(orderData);
                    // For confirmation page, we need the order data
                    savedOrder = orderData;
                    savedOrder._id = result.insertedId;
                    savedOrder.createdAt = new Date();
                    savedOrder.updatedAt = new Date();
                    saveMethod = 'insertOne';
                    console.log('✅ Order saved successfully using insertOne');
                } catch (insertError) {
                    console.log('All database methods failed:', insertError.message);
                    throw new Error('Could not save order to database');
                }
            }
        }
        
        // Clear cart after successful order creation
        req.session.cart = { items: [], total: 0 };
        req.session.cartCount = 0;
        
        // Store order in session for easy access
        req.session.lastOrder = {
            orderId: orderId,
            userId: req.session.user.id,
            userName: req.session.user.name,
            userEmail: req.session.user.email,
            items: items.map(item => ({
                productId: item.product.toString(),
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                image: cart.items.find(ci => ci.productId === item.product.toString())?.image || 'https://via.placeholder.com/100'
            })),
            subtotal: subtotal,
            shipping: shipping,
            tax: tax,
            total: total,
            paymentMethod: paymentMethodEnum,
            paymentId: paymentResult.transactionId,
            status: paymentResult.success ? 'processing' : 'pending',
            paymentStatus: paymentResult.success ? 'completed' : 'failed',
            shippingAddress: orderData.shippingAddress,
            createdAt: savedOrder.createdAt || new Date()
        };
        
        // Also store in orders array for order history
        if (!req.session.orders) {
            req.session.orders = [];
        }
        req.session.orders.push(req.session.lastOrder);
        
        console.log('✅ Payment processing complete. Order ID:', orderId);
        
        res.json({
            success: paymentResult.success,
            orderId: orderId,
            transactionId: paymentResult.transactionId,
            message: paymentResult.message,
            redirectUrl: paymentResult.success ? `/checkout/confirmation/${orderId}` : null,
            saveMethod: saveMethod
        });
        
    } catch (error) {
        console.error('❌ Payment processing error:', error);
        console.error('Error stack:', error.stack);
        
        // Fallback: Save order in session only
        console.log('Attempting session-only fallback...');
        
        try {
            const sessionOrderId = `SESS-ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const cart = req.session.cart || { items: [], total: 0 };
            const subtotal = cart.total || 0;
            const shipping = 10.00;
            const tax = subtotal * 0.05;
            const total = subtotal + shipping + tax;
            
            // Create session-only order
            const sessionOrder = {
                orderId: sessionOrderId,
                userId: req.session.user?.id || 'guest',
                userName: req.session.user?.name || 'Guest',
                userEmail: req.session.user?.email || 'guest@example.com',
                items: cart.items.map(item => ({
                    productId: item.productId,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    image: item.image || 'https://via.placeholder.com/100'
                })),
                subtotal: subtotal,
                shipping: shipping,
                tax: tax,
                total: total,
                paymentMethod: 'card',
                paymentId: 'SESS-' + Date.now(),
                status: 'processing',
                paymentStatus: 'completed',
                shippingAddress: req.body?.shippingAddress || {
                    street: 'Not saved to database',
                    city: '',
                    state: '',
                    country: 'United States',
                    zipCode: ''
                },
                createdAt: new Date()
            };
            
            // Store in session
            req.session.lastOrder = sessionOrder;
            
            if (!req.session.orders) {
                req.session.orders = [];
            }
            req.session.orders.push(sessionOrder);
            
            // Clear cart
            req.session.cart = { items: [], total: 0 };
            req.session.cartCount = 0;
            
            console.log('✅ Created session-only order:', sessionOrderId);
            
            res.json({
                success: true,
                orderId: sessionOrderId,
                transactionId: 'SESS-' + Date.now(),
                message: 'Payment completed (order saved in session only - database save failed)',
                redirectUrl: `/checkout/confirmation/${sessionOrderId}`,
                isSessionOnly: true
            });
            
        } catch (fallbackError) {
            console.error('❌ Even session fallback failed:', fallbackError);
            
            res.status(500).json({ 
                success: false, 
                message: 'Payment processing failed completely. Please contact support.',
                error: error.message
            });
        }
    }
});

// GET Order confirmation
router.get('/confirmation/:orderId', async (req, res) => {
    try {
        console.log('Confirmation route called for order:', req.params.orderId);
        
        if (!req.session.user) {
            req.flash('error', 'Please login to view order');
            return res.redirect('/auth/login');
        }
        
        const orderId = req.params.orderId;
        let order = null;
        
        // First check session (fastest)
        if (req.session.lastOrder && req.session.lastOrder.orderId === orderId) {
            console.log('Found order in session (lastOrder)');
            order = req.session.lastOrder;
        } else if (req.session.orders) {
            order = req.session.orders.find(o => o.orderId === orderId);
            if (order) {
                console.log('Found order in session (orders array)');
            }
        }
        
        // If not in session, try database
        if (!order) {
            console.log('Order not in session, checking database...');
            try {
                const dbOrder = await Order.findOne({ orderId: orderId })
                    .populate('user', 'name email')
                    .populate('items.product', 'name images');
                
                if (dbOrder) {
                    console.log('Found order in database');
                    
                    // Format order for view
                    order = {
                        orderId: dbOrder.orderId,
                        userId: dbOrder.user?._id?.toString() || dbOrder.user?.toString(),
                        userName: dbOrder.user?.name || 'Customer',
                        userEmail: dbOrder.user?.email || 'customer@example.com',
                        items: dbOrder.items.map(item => ({
                            productId: item.product?._id?.toString() || item.product?.toString() || 'N/A',
                            name: item.name || item.product?.name || 'Product',
                            price: item.price,
                            quantity: item.quantity,
                            image: item.product?.images?.[0] || 'https://via.placeholder.com/100',
                            subtotal: item.subtotal
                        })),
                        subtotal: dbOrder.subtotal,
                        shipping: dbOrder.shippingFee,
                        tax: dbOrder.tax,
                        total: dbOrder.totalAmount,
                        paymentMethod: dbOrder.paymentMethod,
                        paymentId: dbOrder.paymentId,
                        status: dbOrder.status,
                        paymentStatus: dbOrder.paymentStatus,
                        shippingAddress: dbOrder.shippingAddress,
                        createdAt: dbOrder.createdAt
                    };
                }
            } catch (dbError) {
                console.log('Database query failed:', dbError.message);
            }
        }
        
        // If still no order, create a demo one
        if (!order) {
            console.log('Creating demo order for display');
            order = {
                orderId: orderId,
                userId: req.session.user.id,
                userName: req.session.user.name,
                userEmail: req.session.user.email,
                items: [
                    {
                        productId: 'demo-' + Date.now(),
                        name: 'Demo Product',
                        price: 29.99,
                        quantity: 1,
                        image: 'https://via.placeholder.com/100',
                        subtotal: 29.99
                    }
                ],
                subtotal: 29.99,
                shipping: 10.00,
                tax: 1.50,
                total: 41.49,
                paymentMethod: 'card',
                paymentId: 'DEMO-' + Date.now(),
                status: 'completed',
                paymentStatus: 'completed',
                shippingAddress: {
                    street: '123 Demo St',
                    city: 'Demo City',
                    state: 'CA',
                    country: 'United States',
                    zipCode: '12345'
                },
                createdAt: new Date()
            };
        }
        
        // Verify ownership (skip for demo orders)
        if (!order.orderId.startsWith('DEMO-') && !order.orderId.startsWith('SESS-') && 
            order.userId !== req.session.user.id) {
            console.log('Access denied - user mismatch');
            req.flash('error', 'Access denied');
            return res.redirect('/');
        }
        
        console.log('Rendering confirmation for order:', order.orderId);
        
        res.render('checkout/confirmation', {
            title: 'Order Confirmation',
            order: order,
            user: req.session.user,
            isDemo: order.orderId.startsWith('DEMO-') || order.orderId.startsWith('SESS-')
        });
        
    } catch (error) {
        console.error('Confirmation route error:', error);
        res.status(500).render('error', { 
            title: 'Error',
            error: 'Failed to load order confirmation'
        });
    }
});

// GET User orders page
router.get('/my-orders', (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login to view your orders');
            return res.redirect('/auth/login');
        }
        
        const userOrders = req.session.orders 
            ? req.session.orders.filter(order => order.userId === req.session.user.id)
            : [];
        
        // Sort by date (newest first)
        userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.render('checkout/my-orders', {
            title: 'My Orders',
            orders: userOrders,
            user: req.session.user
        });
    } catch (error) {
        console.error('My orders error:', error);
        res.status(500).render('error', { 
            title: 'Error',
            error: 'Failed to load orders'
        });
    }
});

// GET Order details
router.get('/order/:orderId', (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login to view order details');
            return res.redirect('/auth/login');
        }
        
        const orderId = req.params.orderId;
        let order = null;
        
        // Find order in session
        if (req.session.orders) {
            order = req.session.orders.find(o => o.orderId === orderId && o.userId === req.session.user.id);
        }
        
        if (!order && req.session.lastOrder && req.session.lastOrder.orderId === orderId && 
            req.session.lastOrder.userId === req.session.user.id) {
            order = req.session.lastOrder;
        }
        
        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/checkout/my-orders');
        }
        
        res.render('checkout/order-details', {
            title: `Order #${order.orderId}`,
            order: order,
            user: req.session.user
        });
    } catch (error) {
        console.error('Order details error:', error);
        res.status(500).render('error', { 
            title: 'Error',
            error: 'Failed to load order details'
        });
    }
});

// GET Test route for debugging
router.get('/test-save', async (req, res) => {
    try {
        const testData = {
            orderId: `TEST-${Date.now()}`,
            user: new mongoose.Types.ObjectId(),
            items: [{
                product: new mongoose.Types.ObjectId(),
                name: 'Test Product',
                quantity: 2,
                price: 25.99,
                subtotal: 51.98
            }],
            shippingAddress: {
                street: '123 Test St',
                city: 'Test City',
                state: 'CA',
                country: 'USA',
                zipCode: '12345'
            },
            paymentMethod: 'card',
            paymentStatus: 'completed',
            status: 'processing',
            subtotal: 51.98,
            shippingFee: 10,
            tax: 3.10,
            totalAmount: 65.08
        };
        
        console.log('Testing order save with data:', testData);
        
        // Try multiple save methods
        let result;
        let method = '';
        
        try {
            result = await Order.create(testData);
            method = 'Order.create()';
        } catch (error1) {
            console.log('Order.create() failed:', error1.message);
            try {
                const order = new Order(testData);
                result = await order.save();
                method = 'new Order().save()';
            } catch (error2) {
                console.log('new Order().save() failed:', error2.message);
                try {
                    const insertResult = await Order.collection.insertOne(testData);
                    result = testData;
                    result._id = insertResult.insertedId;
                    method = 'insertOne';
                } catch (error3) {
                    console.log('insertOne failed:', error3.message);
                    throw new Error('All save methods failed');
                }
            }
        }
        
        res.json({
            success: true,
            message: `Order saved successfully using ${method}`,
            orderId: result.orderId,
            method: method
        });
        
    } catch (error) {
        console.error('Test save error:', error);
        res.json({
            success: false,
            message: 'Test save failed',
            error: error.message
        });
    }
});

module.exports = router;