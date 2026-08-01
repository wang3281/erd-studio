ALTER TABLE products ADD COLUMN seo_title VARCHAR(160);
ALTER TABLE orders ADD COLUMN risk_score DECIMAL(5,2);
ALTER TABLE shipments ADD COLUMN carrier_account VARCHAR(100);

CREATE TABLE returns (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  requested_by BIGINT,
  return_status VARCHAR(30) NOT NULL DEFAULT 'requested',
  reason VARCHAR(255) NOT NULL,
  requested_at TIMESTAMP NOT NULL,
  approved_at TIMESTAMP,
  received_at TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT fk_returns_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_returns_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_returns_requester FOREIGN KEY (requested_by) REFERENCES users(id)
);

CREATE TABLE return_items (
  id BIGINT PRIMARY KEY,
  return_id BIGINT NOT NULL,
  order_item_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  item_condition VARCHAR(60),
  resolution VARCHAR(40) NOT NULL,
  restock_quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_return_items_return FOREIGN KEY (return_id) REFERENCES returns(id),
  CONSTRAINT fk_return_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);
