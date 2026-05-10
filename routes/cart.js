const express = require('express');
const router = express.Router();

// Get cart page
router.get('/', (req, res) => {
    const cart = req.session.cart || { items: [], total: 0 };
    res.render('cart/index', {
        title: 'Shopping Cart',
        cart: {
            items: cart.items || [],
            totalPrice: cart.total || 0,
            totalItems: cart.items ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0
        }
    });
});
// In your cart route file, add this route
router.post('/update', (req, res) => {
    const { index, quantity } = req.body;
    
    if (req.session.cart && req.session.cart.items[index]) {
        req.session.cart.items[index].quantity = parseInt(quantity);
        
        // Recalculate total
        req.session.cart.total = req.session.cart.items.reduce((total, item) => {
            return total + (item.price * item.quantity);
        }, 0);
        
        res.json({ success: true, total: req.session.cart.total });
    } else {
        res.json({ success: false, message: 'Item not found' });
    }
});

router.post('/remove', (req, res) => {
    const { index } = req.body;
    
    if (req.session.cart && req.session.cart.items[index]) {
        req.session.cart.items.splice(index, 1);
        
        // Recalculate total
        req.session.cart.total = req.session.cart.items.reduce((total, item) => {
            return total + (item.price * item.quantity);
        }, 0);
        
        res.json({ success: true, total: req.session.cart.total });
    } else {
        res.json({ success: false, message: 'Item not found' });
    }
});

router.post('/clear', (req, res) => {
    req.session.cart = { items: [], total: 0 };
    res.json({ success: true });
});

module.exports = router;