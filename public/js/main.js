$(document).ready(function() {
    // Add to cart functionality
    $(document).on('click', '.add-to-cart', function() {
        const productId = $(this).data('product-id');
        
        $.ajax({
            url: '/cart/add',
            method: 'POST',
            data: { 
                productId: productId, 
                quantity: 1 
            },
            success: function(response) {
                if (response.success) {
                    // Update cart count
                    const cartCount = response.cartCount || 1;
                    $('.badge.bg-danger').text(cartCount).removeClass('d-none');
                    
                    // Show notification
                    const alertHtml = `
                        <div class="alert alert-success alert-dismissible fade show position-fixed" 
                             style="top: 20px; right: 20px; z-index: 1050;">
                            <i class="fas fa-check-circle"></i> Product added to cart!
                            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                        </div>
                    `;
                    
                    $('body').append(alertHtml);
                    
                    setTimeout(() => {
                        $('.alert').alert('close');
                    }, 3000);
                } else {
                    alert('Error: ' + response.error);
                }
            },
            error: function() {
                alert('Error adding to cart. Please try again.');
            }
        });
    });
    
    // Initialize tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
});