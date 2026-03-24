# Next Campaign Page Kit

[![CI](https://github.com/NextCommerceCo/campaign-page-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/NextCommerceCo/campaign-page-kit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/next-campaign-page-kit)](https://www.npmjs.com/package/next-campaign-page-kit)

Next Campaign Page Kit is a tool for building campaign funnels that can be hosted with any of your favorite static site hosting providers such as Netlify or Cloudflare Pages.

## Motivation

Most static site generators are designed around a single site. When you need to manage multiple campaign funnels in one repository, you quickly run into problems: shared layouts bleed across campaigns, assets collide, and a change to one campaign can silently break another.

Next Campaign Page Kit solves this by treating each campaign as a fully isolated unit within a single repository. Every campaign lives in its own subdirectory with its own layouts, assets, and configuration — but they're all built, versioned, and deployed together.

The CLI tools (`dev`, `clone`, `config`, `compress`) and template filters (`campaign_asset`, `campaign_link`, `campaign_include`) enforce this isolation at every step, so developers can work on one campaign without fear of affecting another.

## Getting Started

### 1. Create a project directory

```bash
mkdir my-campaigns && cd my-campaigns
```

### 2. Initialize and install

```bash
npm init -y
npm install next-campaign-page-kit
```

### 3. Run the setup script

```bash
npx campaign-init
```

This will:
- Add all CLI scripts to your `package.json`
- Create `_data/campaigns.json` — empty campaign registry to get you started

### 4. Add your first campaign to `_data/campaigns.json`

Each entry is keyed by the campaign slug, which must match the campaign's directory name under `src/`.

```json
{
  "my-campaign": {
    "name": "My Campaign",
    "description": "My first campaign",
    "sdk_version": "0.3.10"
  }
}
```

### 5. Create your campaign files

```
src/
└── my-campaign/
    ├── _layouts/
    │   └── base.html
    ├── assets/
    │   └── config.js
    └── presale.html
```

### 6. Set your Campaign API key

```bash
npm run config
```

> [!IMPORTANT]
> Get your Campaign API key from the Campaigns App in your store. See [Campaigns App Guide](https://developers.nextcommerce.com/docs/campaigns/#getting-started).

### 7. Start the development server

```bash
npm run dev
```

This will:
1. Show a list of available campaigns
2. Let you select which campaign to preview
3. Start the dev server
4. Open your browser to the selected campaign

---

## Commands

| Command | Description |
|---|---|
| `npm start` | Interactive menu: dev server, compress, clone, configure |
| `npm run dev` | Start dev server with interactive campaign picker |
| `npm run build` | Build all campaigns to `_site/` |
| `npm run clone` | Clone an existing campaign to a new slug |
| `npm run config` | Set the API key for a campaign |
| `npm run compress` | Compress all images in a campaign directory |
| `npm run compress:preview` | Preview compression savings without modifying files |
| `npm run migrate` | Migrate `campaigns.json` from old array format to key-based format |

### Build

Output will be in the `_site` directory:

```bash
npm run build
```

### Clone Campaign

Clone an existing campaign to create a new one:

```bash
npm run clone
```

## Campaign File Structure

```
your-project/
├── _data/
│   └── campaigns.json          # Campaign registry (contains data for all campaigns)
├── src/
│   └── [campaign-slug]/        # Individual campaign directory
│       ├── _layouts/           # Campaign-specific layouts
│       │   └── base.html       # Base layout template
│       ├── _includes/          # Reusable campaign components
│       ├── assets/             # Campaign assets (CSS, images, JS, config)
│       │   ├── css/            # Campaign styles
│       │   ├── images/         # Campaign images
│       │   ├── js/             # Campaign scripts
│       │   └── config.js       # SDK configuration
│       ├── presale.html        # Presale page (Base URL)
│       ├── checkout.html       # Checkout page
│       ├── upsell.html         # Upsell page
│       ├── receipt.html        # Receipt page
│       └── *.html              # Any other page
└── package.json
```

### Key Files

- **`_data/campaigns.json`** - Register all campaigns and their configuration data here. Uses a key-based format where each key is the campaign slug (see below). If you have an older project using the array format, run `npm run migrate` to convert it.
- **`src/[campaign]/_layouts/base.html`** - Campaign's base layout
- **`src/[campaign]/assets/config.js`** - Campaign Cart SDK configuration

## Page Frontmatter

Each campaign page uses YAML frontmatter to configure the page for context.

### Page Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `page_layout` | string | No | Layout file in `_layouts/`. Defaults to `base.html` |
| `title` | string | Yes | Page title for `<title>` tag |
| `page_type` | string | Yes | Page type: `product`, `checkout`, `upsell`, `receipt` |
| `permalink` | string | No | Custom URL path (e.g., `/starter/`) |
| `next_success_url` | string | No | Redirect URL after successful checkout |
| `next_upsell_accept` | string | No | URL when upsell accepted |
| `next_upsell_decline` | string | No | URL when upsell declined |
| `styles` | array | No | Page-specific CSS files (relative paths or external URLs) |
| `scripts` | array | No | Page-specific JS files (relative paths or external URLs) |
| `footer` | boolean | No | Show footer on this page |


### Example

```yaml
---
page_layout: base.html
title: Checkout
page_type: checkout
next_success_url: upsell.html
styles:
  - https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css
  - css/offer.css
scripts:
  - https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js
  - js/offer.js
footer: true
---
```


## Campaign Context (`campaign`)

Each page automatically has access to its campaign's data from `_data/campaigns.json` via the `campaign` object. This allows you to provide configured context directly to your pages.

### Usage

You can access any key defined in your campaign's entry in `_data/campaigns.json`:

```liquid
<h1>{{ campaign.name }}</h1>
<p>Contact: {{ campaign.support_email }}</p>
```

### Adding Custom Context

To add more context across all pages in your campaign, simply add new keys to your campaign in `_data/campaigns.json`:

```json
{
  "starter": {
    "name": "Starter Campaign",
    "support_email": "support@example.com",
    "custom_headline": "Welcome to our Store!"
  }
}
```

Then the context is available to use it in your templates:

```liquid
<h2>{{ campaign.custom_headline }}</h2>
```

### Environment Variable

The `environment` variable is available in all templates and indicates the current build mode. This is useful for conditionally including analytics scripts, debug tools, or other environment-specific content.

| Command | Default Value |
|---|---|
| `npm run dev` | `development` |
| `npm run build` | `production` |

**Usage:**

```liquid
{% unless environment == "development" %}
  <!-- Google Tag Manager -->
  <script>...</script>
{% endunless %}
```

**Override with `CPK_ENV`:**

Set the `CPK_ENV` environment variable to override the default value. This is useful for build pipelines like Netlify or GitHub Pages where you may want a custom environment such as `staging`.

```bash
CPK_ENV=staging npm run build
```

### Layout Resolution

Layouts are automatically resolved to the campaign's `_layouts/` directory:

- `page_layout: base.html` → `starter/_layouts/base.html`
- `page_layout: custom.html` → `starter/_layouts/custom.html`

**No layout specified?** Defaults to `base.html`.

## Template Tags (Filters)

Templates use [Liquid](https://shopify.github.io/liquid/basics/introduction/) syntax. Next Campaign Page Kit provides additional custom filters and tags for campaign-relative includes, assets, and links.

> [!TIP]
> Use campaign template filters to ensure your includes, assets, and links are automatically handled when cloning templates to a fresh new campaign.

### `campaign_asset`

Resolves asset paths to the current campaign.

**Syntax:**
```liquid
{{ 'filename' | campaign_asset }}
```

**Examples:**
```liquid
<!-- Config -->
<script src="{{ 'config.js' | campaign_asset }}"></script>
<!-- Output: /starter/config.js -->

<!-- CSS -->
<link href="{{ 'css/custom.css' | campaign_asset }}" rel="stylesheet">
<!-- Output: /starter/css/custom.css -->

<!-- Images -->
<img src="{{ 'images/logo.png' | campaign_asset }}" alt="Logo">
<!-- Output: /starter/images/logo.png -->
```

**Use for:** CSS files, JavaScript files, images, config.js, any campaign asset.

---

### `campaign_link`

Generates clean URLs for inter-page navigation.

**Syntax:**
```liquid
{{ 'filename.html' | campaign_link }}
```

**Examples:**
```liquid
<!-- Navigation link -->
<a href="{{ 'checkout.html' | campaign_link }}">Checkout</a>
<!-- Output: /starter/checkout/ -->

<!-- Campaign Cart meta tag -->
<meta name="next-success-url" content="{{ next_success_url | campaign_link }}">
<!-- Output: /starter/upsell/ -->

<!-- Data attribute -->
<button data-next-url="{{ 'upsell.html' | campaign_link }}">Continue</button>
<!-- Output: /starter/upsell/ -->
```

**Features:**
- Removes `.html` extension
- Adds trailing slash
- Prepends campaign slug
- Handles anchor links (`#section`) and absolute URLs

**Use for:** Page links, navigation URLs, redirect URLs, Campaign Cart SDK meta tags.

---

### `campaign_include`

Includes a file relative to the current campaign's `_includes` directory. This is useful for including reusable components that are specific to a campaign.

**Syntax:**
```liquid
{% campaign_include 'filename.html' arg=value %}
```

**Examples:**
```liquid
<!-- Include a slider component -->
{% campaign_include 'slider.html' images=slider_images %}

<!-- Include with parameters -->
{% campaign_include 'slider.html' images=slider_images show_package_image=true %}
```

**Use for:** Reusable components within a campaign (e.g., sliders, testimonials).

## Connecting to Campaigns App

To connect this campaign to your 29 Next Campaigns App:

1. Run `npm run config`
2. Select your campaign
3. Enter your API key from the Campaigns App
4. Deploy your campaign

For more details, see the [Campaigns App documentation](https://developers.nextcommerce.com/docs/campaigns/#getting-started).

## Test Orders

You can use our [test cards](https://developers.nextcommerce.com/docs/admin-api/guides/testing-guide/) to create test orders.

## Compress Images

Compress all images in a campaign directory in-place. Supports JPEG, PNG, WebP, and GIF. Only overwrites a file if the compressed output is smaller than the original.

```bash
npm run compress
```

This will:
1. Show a list of available campaigns
2. Let you select which campaign to compress
3. Compress all images found anywhere in the campaign directory (`src/[campaign]/`)
4. Print a before/after table with file sizes and total savings

**Preview mode** — see what would be saved without modifying any files:

```bash
npm run compress:preview
```

Example output:

```
◇  Found 3 images
◇  2 images ready to compress

--------------------------------------------+----------+----------+----------+-------+---------
 File                                       | Before   | After    | Saved    | %     | Status
--------------------------------------------+----------+----------+----------+-------+---------
 src/my-campaign/assets/images/hero.jpg     | 145.3 KB | 88.2 KB  | -57.1 KB | 39.3% | preview
 src/my-campaign/assets/images/product.png  | 80.0 KB  | 54.0 KB  | -26.0 KB | 32.5% | preview
--------------------------------------------+----------+----------+----------+-------+---------
 TOTAL                                      | 225.3 KB | 142.2 KB | -83.1 KB | 36.9% |
--------------------------------------------+----------+----------+----------+-------+---------

[NEXT] DEBUG 1 image already fully compressed, skipped
└  Preview complete — run without --preview to apply changes.
```

Already-optimized images are skipped and reported in the debug line above the summary.
