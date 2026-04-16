# Demo Funnel Example

A minimal 4-page campaign you can drop into your own project to see the funnel map in action.

## Files

```
demo-funnel/
├── _layouts/
│   └── base.html        # Minimal layout (uses {{ content }} and {{ campaign.name }})
├── index.html           # page_type: product    → next_success_url: checkout
├── checkout.html        # page_type: checkout   → next_success_url: upsell
├── upsell.html          # page_type: upsell     → accept/decline: receipt
└── receipt.html         # page_type: receipt    (terminal, no next_* fields)
```

## Try it

1. Copy this directory into your project's `src/`:
   ```bash
   cp -r docs/examples/demo-funnel src/demo-funnel
   ```
2. Register the campaign in `_data/campaigns.json`:
   ```json
   {
     "demo-funnel": {
       "name": "Demo Funnel",
       "description": "Funnel map demo"
     }
   }
   ```
3. Build:
   ```bash
   npm run build
   ```
4. Open `.cpk/demo-funnel/funnel.html` in your browser.

You should see a graph with four nodes (product → checkout → upsell → receipt), color-coded by `page_type`, with edge labels for `success`, `accept`, and `decline`.

See the full guide: [../../funnel-map.md](../../funnel-map.md)
