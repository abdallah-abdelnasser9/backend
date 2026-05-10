const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { isAuthenticated } = require('../middleware/authMiddleware');
const paypal = require('@paypal/checkout-server-sdk');

// PayPal setup
let environment = new paypal.core.SandboxEnvironment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
);
let client = new paypal.core.PayPalHttpClient(environment);

// Checkout
router.get('/checkout', isAuthenticated, async (req, res) => {
    try {
        const cart = await Cart.findOne({ user: req.session.user.id })
            .populate('items.product');
        
        if (!cart || cart.items.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }
        
        // Check stock availability
        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            if (product.stock < item.quantity) {
                req.flash('error', `${product.name} is out of stock`);
                return res.redirect('/cart');
            }
        }
        
        res.render('orders/checkout', {
            title: 'Checkout',
            cart,
            user: req.session.user
        });
    } catch (error) {
        console.error(error);
        res.redirect('/cart');
    }
});

// Place order
router.post('/place', isAuthenticated, async (req, res) => {
    try {
        const { shippingAddress, paymentMethod } = req.body;
        
        const cart = await Cart.findOne({ user: req.session.user.id })
            .populate('items.product');
        
        if (!cart || cart.items.length === 0) {
            return res.json({ success: false, error: 'Cart is empty' });
        }
        
        // Check stock again
        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            if (product.stock < item.quantity) {
                return res.json({ 
                    success: false, 
                    error: `${product.name} is out of stock` 
                });
            }
        }
        
        // Create order
        const orderItems = cart.items.map(item => ({
            product: item.product._id,
            name: item.product.name,
            quantity: item.quantity,
            price: item.price,
            color: item.color,
            size: item.size,
            subtotal: item.price * item.quantity
        }));
        
        const subtotal = cart.totalPrice;
        const shippingFee = 10; // Fixed shipping for demo
        const tax = subtotal * 0.05; // 5% tax
        const totalAmount = subtotal + shippingFee + tax;
        
        // Generate unique order ID
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        const orderId = `ORD-${timestamp}-${random}`;
        
        const order = new Order({
            orderId: orderId,
            user: req.session.user.id, // Use req.session.user.id
            items: orderItems,
            shippingAddress,
            paymentMethod,
            subtotal,
            shippingFee,
            tax,
            totalAmount
        });
        
        // If PayPal, create payment
        if (paymentMethod === 'paypal') {
            const request = new paypal.orders.OrdersCreateRequest();
            request.prefer("return=representation");
            request.requestBody({
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: {
                        currency_code: 'USD',
                        value: totalAmount.toFixed(2)
                    }
                }],
                application_context: {
                    return_url: `${req.protocol}://${req.get('host')}/orders/paypal/success`,
                    cancel_url: `${req.protocol}://${req.get('host')}/orders/paypal/cancel`
                }
            });
            
            const paypalOrder = await client.execute(request);
            order.paymentId = paypalOrder.result.id;
            
            await order.save();
            
            // Find approval link
            const approvalLink = paypalOrder.result.links.find(
                link => link.rel === 'approve'
            );
            
            return res.json({
                success: true,
                paymentMethod: 'paypal',
                approvalUrl: approvalLink.href
            });
        }
        
        // For COD or other methods
        await order.save();
        
        // Update product stock
        for (const item of cart.items) {
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { stock: -item.quantity }
            });
        }
        
        // Clear cart
        await Cart.findOneAndUpdate(
            { user: req.session.user.id }, // Use req.session.user.id
            { items: [], totalPrice: 0, totalItems: 0 }
        );
        
        req.session.cartCount = 0;
        
        res.json({
            success: true,
            paymentMethod: paymentMethod,
            orderId: order._id
        });
        
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// PayPal success
router.get('/paypal/success', isAuthenticated, async (req, res) => {
    try {
        const { token } = req.query;
        
        const order = await Order.findOne({ paymentId: token });
        if (!order) {
            throw new Error('Order not found');
        }
        
        // Capture payment
        const request = new paypal.orders.OrdersCaptureRequest(token);
        request.requestBody({});
        
        const capture = await client.execute(request);
        
        // Update order
        order.paymentStatus = 'completed';
        order.status = 'processing';
        order.paymentId = capture.result.id;
        
        await order.save();
        
        // Update product stock
        for (const item of order.items) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { stock: -item.quantity }
            });
        }
        
        // Clear cart
        await Cart.findOneAndUpdate(
            { user: req.session.user.id }, // Use req.session.user.id
            { items: [], totalPrice: 0, totalItems: 0 }
        );
        
        req.session.cartCount = 0;
        
        res.redirect(`/orders/${order._id}/success`);
        
    } catch (error) {
        console.error(error);
        req.flash('error', 'Payment failed');
        res.redirect('/cart');
    }
});

// PayPal cancel
router.get('/paypal/cancel', isAuthenticated, (req, res) => {
    req.flash('error', 'Payment cancelled');
    res.redirect('/cart');
});

// Order success
router.get('/:id/success', isAuthenticated, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('user');
        
        if (!order || order.user._id.toString() !== req.session.user.id) { // Use req.session.user.id
            return res.redirect('/');
        }
        
        res.render('orders/success', {
            title: 'Order Success',
            order
        });
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});

// My orders - FIXED VERSION
router.get('/my-orders', isAuthenticated, async (req, res) => {
    try {
        // Use req.session.user.id (NOT req.session.userId)
        const userId = req.session.user.id;
        
        console.log('Fetching orders for user ID:', userId);
        
        const orders = await Order.find({ user: userId })
            .sort({ createdAt: -1 })
            .populate('items.product', 'name images');
        
        console.log(`Found ${orders.length} orders`);
        
        res.render('orders/my-orders', {
            title: 'My Orders',
            orders,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        req.flash('error', 'Failed to load orders');
        res.redirect('/');
    }
});

// Order details
router.get('/:id', isAuthenticated, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('items.product');
        
        // Use req.session.user.id for comparison
        if (!order || order.user.toString() !== req.session.user.id) {
            return res.redirect('/orders/my-orders');
        }
        
        res.render('orders/detail', {
            title: 'Order Details',
            order
        });
    } catch (error) {
        console.error(error);
        res.redirect('/orders/my-orders');
    }
});

// Cancel order
router.post('/:id/cancel', isAuthenticated, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        // Use req.session.user.id for comparison
        if (!order || order.user.toString() !== req.session.user.id) {
            return res.json({ success: false, error: 'Order not found' });
        }
        
        // Only allow cancellation if order is pending or processing
        if (!['pending', 'processing'].includes(order.status)) {
            return res.json({ 
                success: false, 
                error: 'Cannot cancel order at this stage' 
            });
        }
        
        order.status = 'cancelled';
        order.cancelledAt = new Date();
        
        // Restore stock
        for (const item of order.items) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { stock: item.quantity }
            });
        }
        
        await order.save();
        
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// Track order
router.get('/:id/track', isAuthenticated, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        // Use req.session.user.id for comparison
        if (!order || order.user.toString() !== req.session.user.id) {
            return res.redirect('/orders/my-orders');
        }
        
        res.render('orders/track', {
            title: 'Track Order',
            order
        });
    } catch (error) {
        console.error(error);
        res.redirect('/orders/my-orders');
    }
});
// Add this route to your order.js file
router.post('/:id/remove-from-list', isAuthenticated, async (req, res) => {
    try {
        // Note: This doesn't delete from database, just marks as hidden for user
        // You could implement a "hidden" field in your Order model
        
        // For now, we'll just return success since we're only hiding in UI
        res.json({ 
            success: true,
            message: 'Order removed from view'
        });
    } catch (error) {
        console.error(error);
        res.json({ 
            success: false, 
            error: 'Failed to remove order from list' 
        });
    }
});

// Download invoice
router.get('/:id/invoice', isAuthenticated, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('user')
            .populate('items.product');
        
        // Use req.session.user.id for comparison
        if (!order || order.user._id.toString() !== req.session.user.id) {
            return res.redirect('/orders/my-orders');
        }
        
        // Generate PDF invoice (simplified for demo)
        // In production, use a library like pdfkit or puppeteer
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderId}.pdf`);
        
        // Simple HTML invoice for demo
        const invoiceHTML = `
            <html>
            <head>
                <title>Invoice ${order.orderId}</title>
                <style>
                    body { font-family: Arial, sans-serif; }
                    .invoice { max-width: 800px; margin: 0 auto; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .details { margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    .total { text-align: right; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="invoice">
                    <div class="header">
                        <h1>INVOICE</h1>
                        <p>Order ID: ${order.orderId}</p>
                        <p>Date: ${order.createdAt.toLocaleDateString()}</p>
                    </div>
                    
                    <div class="details">
                        <p><strong>Customer:</strong> ${order.user.name}</p>
                        <p><strong>Shipping Address:</strong> ${JSON.stringify(order.shippingAddress)}</p>
                        <p><strong>Status:</strong> ${order.status}</p>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Quantity</th>
                                <th>Price</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${order.items.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.quantity}</td>
                                    <td>$${item.price}</td>
                                    <td>$${item.subtotal}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3">Subtotal</td>
                                <td>$${order.subtotal}</td>
                            </tr>
                            <tr>
                                <td colspan="3">Shipping</td>
                                <td>$${order.shippingFee}</td>
                            </tr>
                            <tr>
                                <td colspan="3">Tax</td>
                                <td>$${order.tax}</td>
                            </tr>
                            <tr class="total">
                                <td colspan="3">Total</td>
                                <td>$${order.totalAmount}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </body>
            </html>
        `;
        
        res.send(invoiceHTML);
        
    } catch (error) {
        console.error(error);
        res.redirect('/orders/my-orders');
    }
});

module.exports = router;