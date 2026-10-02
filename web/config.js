'use strict';

document.querySelectorAll('[data-pool]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelector('[name="pool_url"]').value = button.dataset.pool;
    document.querySelector('[name="pool_port"]').value = button.dataset.port;
  });
});
