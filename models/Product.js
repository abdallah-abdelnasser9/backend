const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    slug: {
        type: String,
        required: true,
        unique: true
    },
    description: String,
    brand: String,
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    subcategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    },
    price: {
        type: Number,
        required: true
    },
    discountPrice: Number,
    discountPercentage: Number,
    images: [String],
    colors: [String],
    sizes: [String],
    specifications: Map,
    features: [String],
    stock: {
        type: Number,
        required: true,
        default: 0
    },
    lowStockThreshold: {
        type: Number,
        default: 10
    },
  sku: {
    type: String,
    unique: true,
    default: () => "SKU-" + Math.random().toString(36).substring(2, 10).toUpperCase()
},
    rating: {
        type: Number,
        default: 0
    },
    reviewsCount: {
        type: Number,
        default: 0
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Product', productSchema);