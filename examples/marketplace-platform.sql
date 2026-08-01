CREATE TABLE organizations (
  id BIGINT PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  billing_email VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  default_currency VARCHAR(3) NOT NULL DEFAULT 'KRW',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30),
  locale VARCHAR(10) NOT NULL DEFAULT 'ko-KR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE organization_members (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  job_title VARCHAR(120),
  member_status VARCHAR(30) NOT NULL DEFAULT 'invited',
  joined_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_members_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE roles (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  role_key VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_roles_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE member_roles (
  id BIGINT PRIMARY KEY,
  member_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  granted_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_member_roles_member FOREIGN KEY (member_id) REFERENCES organization_members(id),
  CONSTRAINT fk_member_roles_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE addresses (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT,
  address_type VARCHAR(30) NOT NULL,
  recipient_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30),
  postal_code VARCHAR(20) NOT NULL,
  line1 VARCHAR(255) NOT NULL,
  line2 VARCHAR(255),
  city VARCHAR(120) NOT NULL,
  country_code VARCHAR(2) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_addresses_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE categories (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  parent_id BIGINT,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_categories_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE TABLE products (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  category_id BIGINT,
  sku VARCHAR(80) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  product_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  base_price DECIMAL(12,2) NOT NULL,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  weight_grams INTEGER,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_products_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE product_variants (
  id BIGINT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  variant_sku VARCHAR(100) NOT NULL UNIQUE,
  option_name VARCHAR(120) NOT NULL,
  barcode VARCHAR(100),
  price_adjustment DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cost_price DECIMAL(12,2),
  weight_grams INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE warehouses (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  timezone VARCHAR(60) NOT NULL,
  address_line VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_warehouses_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE inventory_items (
  id BIGINT PRIMARY KEY,
  warehouse_id BIGINT NOT NULL,
  variant_id BIGINT NOT NULL,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  quantity_reserved INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_inventory_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_inventory_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id)
);

CREATE TABLE inventory_movements (
  id BIGINT PRIMARY KEY,
  inventory_item_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  actor_user_id BIGINT,
  movement_type VARCHAR(30) NOT NULL,
  quantity_delta INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reference_type VARCHAR(40),
  reference_id BIGINT,
  occurred_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_movements_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
  CONSTRAINT fk_movements_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_movements_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE carts (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT,
  cart_status VARCHAR(30) NOT NULL DEFAULT 'active',
  currency VARCHAR(3) NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_carts_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE cart_items (
  id BIGINT PRIMARY KEY,
  cart_id BIGINT NOT NULL,
  variant_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  added_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id),
  CONSTRAINT fk_cart_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id)
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT,
  shipping_address_id BIGINT NOT NULL,
  billing_address_id BIGINT,
  order_number VARCHAR(60) NOT NULL UNIQUE,
  order_status VARCHAR(30) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  subtotal_amount DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(12,2) NOT NULL,
  shipping_amount DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  placed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_orders_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_shipping_address FOREIGN KEY (shipping_address_id) REFERENCES addresses(id),
  CONSTRAINT fk_orders_billing_address FOREIGN KEY (billing_address_id) REFERENCES addresses(id)
);

CREATE TABLE order_items (
  id BIGINT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  variant_id BIGINT NOT NULL,
  sku_snapshot VARCHAR(100) NOT NULL,
  name_snapshot VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id)
);

CREATE TABLE payments (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_payment_id VARCHAR(160),
  payment_status VARCHAR(30) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  failure_code VARCHAR(80),
  authorized_at TIMESTAMP,
  captured_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_payments_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE refunds (
  id BIGINT PRIMARY KEY,
  payment_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  provider_refund_id VARCHAR(160),
  refund_status VARCHAR(30) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(255),
  requested_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE shipments (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  shipment_status VARCHAR(30) NOT NULL,
  carrier VARCHAR(80),
  tracking_number VARCHAR(160),
  shipped_at TIMESTAMP,
  delivered_at TIMESTAMP,
  estimated_delivery_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_shipments_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE shipment_items (
  id BIGINT PRIMARY KEY,
  shipment_id BIGINT NOT NULL,
  order_item_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  packed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_shipment_items_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id),
  CONSTRAINT fk_shipment_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);

CREATE TABLE subscription_plans (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  plan_key VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  billing_interval VARCHAR(20) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_plans_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE subscriptions (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  plan_id BIGINT NOT NULL,
  subscription_status VARCHAR(30) NOT NULL,
  provider_subscription_id VARCHAR(160),
  current_period_start TIMESTAMP NOT NULL,
  current_period_end TIMESTAMP NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_subscriptions_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

CREATE TABLE invoices (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  subscription_id BIGINT NOT NULL,
  invoice_number VARCHAR(60) NOT NULL UNIQUE,
  invoice_status VARCHAR(30) NOT NULL,
  subtotal_amount DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  due_at TIMESTAMP NOT NULL,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_invoices_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_invoices_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE TABLE audit_events (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  actor_user_id BIGINT,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  event_payload TEXT,
  occurred_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_audit_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE webhook_endpoints (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  endpoint_url VARCHAR(500) NOT NULL,
  signing_secret_ref VARCHAR(255) NOT NULL,
  subscribed_events TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_webhooks_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE webhook_deliveries (
  id BIGINT PRIMARY KEY,
  webhook_endpoint_id BIGINT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload TEXT NOT NULL,
  response_status INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_deliveries_endpoint FOREIGN KEY (webhook_endpoint_id) REFERENCES webhook_endpoints(id)
);

COMMENT ON TABLE organizations IS 'Tenant boundary for commerce data';
COMMENT ON TABLE inventory_movements IS 'Immutable stock movement ledger';
COMMENT ON COLUMN orders.order_number IS 'Public order identifier displayed to customers';
