const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { isAdmin } = require('../middleware/authMiddleware');

// Apply admin middleware to all routes
router.use(isAdmin);

// ============================
// ORDER MANAGEMENT ROUTES
router.get('/orders', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        // Add null handling in populate
        const orders = await Order.find()
            .populate({
                path: 'user',
                select: 'name email',
                // This ensures the query still works even if user doesn't exist
                options: { allowNull: true }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        // Transform orders to ensure user object exists
        const safeOrders = orders.map(order => {
            const orderObj = order.toObject();
            
            // Ensure user object exists even if population failed
            if (!orderObj.user || !orderObj.user._id) {
                orderObj.user = {
                    name: 'Guest/Deleted User',
                    email: 'N/A',
                    _id: null
                };
            }
            
            return orderObj;
        });
        
        const totalOrders = await Order.countDocuments();
        const totalPages = Math.ceil(totalOrders / limit);
        
        res.render('admin/orders/index', {
            layout: 'layouts/admin-layout',
            title: 'Manage Orders',
            currentPage: 'orders',
            user: req.user || req.session.user,
            orders: safeOrders, // Use the transformed orders
            currentPageNum: page,
            totalPages: totalPages,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading orders:', error);
        req.flash('error', 'Error loading orders');
        res.redirect('/admin/dashboard');
    }
});
// View single order by orderId
router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const order = await Order.findOne({ orderId: orderId })
            .populate('user', 'name email phone')
            .populate('items.product', 'name images price');
        
        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/admin/orders');
        }
        
        // Create a safe order object
        const safeOrder = order.toObject();
        
        // Ensure user object exists
        if (!safeOrder.user || !safeOrder.user._id) {
            safeOrder.user = {
                name: 'Guest/Deleted User',
                email: 'N/A',
                phone: 'N/A'
            };
        }
        
        const statusOptions = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
        const paymentStatusOptions = ['pending', 'completed', 'failed', 'refunded'];
        
        res.render('admin/orders/detail', {
            layout: 'layouts/admin-layout',
            title: `Order #${order.orderId}`,
            currentPage: 'orders',
            order: safeOrder, // Use the safe order
            statusOptions: statusOptions,
            paymentStatusOptions: paymentStatusOptions,
            user: req.user || req.session.user,
            error_msg: req.flash('error'),
            success_msg: req.flash('success')
        });
    } catch (error) {
        console.error('Admin order details error:', error);
        req.flash('error', 'Failed to load order details');
        res.redirect('/admin/orders');
    }
});
// Update order status
router.post('/orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, paymentStatus} = req.body;
        
        const updateData = {};
        if (status) updateData.status = status;
        if (paymentStatus) updateData.paymentStatus = paymentStatus;
        
        // If status is delivered, set deliveredAt
        if (status === 'delivered') {
            updateData.deliveredAt = new Date();
        }
        
        // If status is cancelled, set cancelledAt
        if (status === 'cancelled') {
            updateData.cancelledAt = new Date();
        }
        
        // Find by orderId field, not _id
        const order = await Order.findOneAndUpdate(
            { orderId: orderId },
            updateData,
            { new: true }
        );
        
        if (!order) {
            req.flash('error', 'Order not found');
        } else {
            req.flash('success', `Order status updated to ${status}`);
        }
        
        res.redirect(`/admin/orders/${orderId}`);
    } catch (error) {
        console.error('Update order status error:', error);
        req.flash('error', 'Failed to update order status');
        res.redirect(`/admin/orders/${req.params.orderId}`);
    }
});

// Delete order
router.post('/orders/:orderId/delete', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Find by orderId field, not _id
        const order = await Order.findOneAndDelete({ orderId: orderId });
        
        if (!order) {
            req.flash('error', 'Order not found');
        } else {
            req.flash('success', 'Order deleted successfully');
        }
        
        res.redirect('/admin/orders');
    } catch (error) {
        console.error('Delete order error:', error);
        req.flash('error', 'Failed to delete order');
        res.redirect('/admin/orders');
    }
});

module.exports = router;