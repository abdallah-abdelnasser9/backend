const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: String,
    images: [String],
    isVerifiedPurchase: {
        type: Boolean,
        default: false
    },
    helpful: {
        type: Number,
        default: 0
    },
    notHelpful: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Update product rating when review is added
reviewSchema.post('save', async function() {
    const Review = this.constructor;
    const reviews = await Review.find({ product: this.product });
    
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    const averageRating = totalRating / reviews.length;
    
    await mongoose.model('Product').findByIdAndUpdate(this.product, {
        rating: averageRating,
        reviewsCount: reviews.length
    });
});

module.exports = mongoose.model('Review', reviewSchema);