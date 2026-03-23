const mongoose = require('mongoose');

const PlaidItemSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    accessToken: {
        type: String,
        required: true
    },
    itemId: {
        type: String,
        required: true
    },
    institutionName: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('PlaidItem', PlaidItemSchema);
