-- Set all warehouses to read-only for stock/purchase price writes.
UPDATE warehouses
SET can_modify_stock = 0;
