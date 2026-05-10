const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');

// Get all products
router.get('/', async (req, res) => {
    try {
        let query = { isActive: true };
        
        // Get categories for sidebar
        const categories = await Category.find({ parent: null, isActive: true });
        
        // Get products
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
        res.status(500).render('error', { 
            title: 'Error',
            error: 'Something went wrong' 
        });
    }
});

// Product details
router.get('/:slug', async (req, res) => {
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

module.exports = router;