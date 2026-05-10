const mongoose = require('mongoose');
const Schema = mongoose.Schema; // Define Schema from mongoose

const chatSchema = new Schema({
    sender: {
        type: String,  // Can be 'admin' or user ID
        required: true
    },
    receiver: {
        type: String,  // Can be 'admin' or user ID
        required: true
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    messageType: {
        type: String,
        enum: ['text', 'product_inquiry', 'product_response', 'auto_response', 'broadcast'],
        default: 'text'
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    isRead: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes for faster queries
chatSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
chatSchema.index({ receiver: 'admin', isRead: 1 });
chatSchema.index({ createdAt: -1 });
chatSchema.index({ messageType: 1 });

module.exports = mongoose.model('Chat', chatSchema);