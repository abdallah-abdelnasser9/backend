const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// GET User's orders
router.get('/my-orders', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login to view your orders');
            return res.redirect('/auth/login');
        }
        
        // Find orders for this user from MongoDB
        const orders = await Order.find({ user: req.session.user.id })
            .sort({ createdAt: -1 }) // Newest first
            .populate('items.product', 'name images');
        
        // Format orders for the view
        const formattedOrders = orders.map(order => ({
            orderId: order.orderId,
            createdAt: order.createdAt,
            items: order.items.map(item => ({
                name: item.name || item.product?.name || 'Product',
                quantity: item.quantity,
                price: item.price,
                image: item.product?.images?.[0] || 'https://via.placeholder.com/100'
            })),
            total: order.totalAmount,
            status: order.status,
            paymentStatus: order.paymentStatus,
            paymentMethod: order.paymentMethod
        }));
        
        res.render('user/orders', {
            title: 'My Orders',
            orders: formattedOrders,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: 'Failed to load orders'
        });
    }
});

// GET Single order details
router.get('/:orderId', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', 'Please login to view order details');
            return res.redirect('/auth/login');
        }
        
        const orderId = req.params.orderId;
        
        // Find order in MongoDB
        const order = await Order.findOne({ 
            orderId: orderId,
            user: req.session.user.id 
        })
        .populate('user', 'name email')
        .populate('items.product', 'name images description');
        
        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders/my-orders');
        }
        
        // Format order for the view
        const formattedOrder = {
            orderId: order.orderId,
            createdAt: order.createdAt,
            items: order.items.map(item => ({
                productId: item.product?._id.toString(),
                name: item.name || item.product?.name || 'Product',
                description: item.product?.description || '',
                price: item.price,
                quantity: item.quantity,
                image: item.product?.images?.[0] || 'https://via.placeholder.com/100',
                subtotal: item.subtotal
            })),
            subtotal: order.subtotal,
            shipping: order.shippingFee,
            tax: order.tax,
            total: order.totalAmount,
            paymentMethod: order.paymentMethod,
            paymentId: order.paymentId,
            status: order.status,
            paymentStatus: order.paymentStatus,
            shippingAddress: order.shippingAddress,
            trackingNumber: order.trackingNumber,
            deliveredAt: order.deliveredAt
        };
        
        res.render('user/order-details', {
            title: `Order #${order.orderId}`,
            order: formattedOrder,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: 'Failed to load order details'
        });
    }
});

module.exports = router;