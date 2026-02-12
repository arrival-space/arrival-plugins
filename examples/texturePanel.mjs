/**
 * Texture Panel Demo Plugin - Creates a 3D HTML panel with transparency
 * 
 * Load it using: await this.loadPlugin('path/to/texturePanel.mjs');
 * 
 * This demonstrates createTexturePanel from ArrivalPluginUtils which renders
 * HTML server-side to a texture with TRUE transparency and clickable links.
 * 
 * Features demonstrated:
 * - Multiline string (htmlContent contains \n) → shows EditTextMultiline in UI
 * - Number properties for panel sizing
 * - Boolean for billboard toggle
 * 
 * IMPORTANT FOR LLMs AND DEVELOPERS:
 * ----------------------------------
 * This panel is RENDERED TO A TEXTURE server-side. This means:
 * - TRUE transparency is supported (alpha channel)
 * - ONLY <a href="..."> tags are clickable (detected and made interactive)
 * - <button>, onclick, JavaScript events DO NOT WORK
 * - Use <a> tags styled as buttons for clickable elements
 * - Links open in new tab or trigger onAnchorClick callback
 * 
 * For interactive buttons/forms, use createHTMLPanel() instead (CSS3-based).
 * 
 * Properties:
 * - htmlContent: The HTML content to display (multiline → textarea in UI)
 * - panelWidth: Panel width in world units
 * - panelHeight: Panel height in world units
 * - resolution: Pixels per unit (higher = sharper)
 * - billboard: Always face the camera
 * - offsetY: Vertical offset from entity position
 */

export class TexturePanel extends pc.Script {
    static scriptName = 'texturePanel';
    
    // Public properties - configurable in UI
    // NOTE: Only <a href="..."> tags are clickable! Style them as buttons.
    htmlContent = `
<div style="
    width: 100%;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    background: rgba(30, 40, 60, 0.9);
    border-radius: 20px;
    border: 2px solid rgba(100, 180, 255, 0.6);
    font-family: Arial, sans-serif;
    color: white;
    display: flex;
    flex-direction: column;
    gap: 12px;
">
    <h2 style="margin: 0; color: #7dd3fc; font-size: 28px;">
        🎮 Welcome!
    </h2>
    <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #e0e0e0;">
        This is a texture panel with <strong>true transparency</strong> 
        and rounded corners.
    </p>
    <!-- Use <a> styled as button - onclick/button tags won't work! -->
    <a href="https://arrival.space/explore" style="
        display: block;
        margin-top: auto;
        padding: 12px 24px;
        background: linear-gradient(135deg, #3b82f6, #8b5cf6);
        border-radius: 12px;
        text-align: center;
        font-weight: bold;
        font-size: 18px;
        color: white;
        text-decoration: none;
        cursor: pointer;
    ">
        ✨ Explore Spaces
    </a>
    <a href="https://arrival.space" style="
        display: block;
        color: #7dd3fc;
        text-align: center;
        font-size: 14px;
    ">
        Visit arrival.space →
    </a>
</div>
    `.trim();
    
    panelWidth = 2;
    panelHeight = 1.5;
    resolution = 300;
    billboard = false;
    offsetY = 1.5;
    
    // Private properties
    _panel = null;
    _isLoading = false;
    _lastHtmlContent = '';
    _lastWidth = 0;
    _lastHeight = 0;
    
    async initialize() {
        console.log('📋 TexturePanel initialized on entity:', this.entity.name);
        
        // Create the panel
        await this._createPanel();
        
        // Store initial values
        this._lastHtmlContent = this.htmlContent;
        this._lastWidth = this.panelWidth;
        this._lastHeight = this.panelHeight;
        
        // Cleanup on destroy
        this.once('destroy', () => {
            console.log('TexturePanel destroyed');
            if (this._panel && !this._panel._destroyed) {
                this._panel.destroy();
                this._panel = null;
            }
        });
        
        this.on('enable', () => {
            if (this._panel) this._panel.enabled = true;
        });
        
        this.on('disable', () => {
            if (this._panel) this._panel.enabled = false;
        });
    }
    
    async _createPanel() {
        if (this._isLoading) return;
        this._isLoading = true;
        
        // Destroy existing panel
        if (this._panel && !this._panel._destroyed) {
            this._panel.destroy();
            this._panel = null;
        }
        
        const pos = this.entity.getPosition();
        
        // Try to use ArrivalPluginUtils if available
        const utils = window.ArrivalPluginUtils;
        if (utils?.createTexturePanel) {
            try {
                // Create at origin, we'll reparent it
                this._panel = await utils.createTexturePanel({
                    position: { x: 0, y: 0, z: 0 },
                    width: this.panelWidth,
                    height: this.panelHeight,
                    resolution: this.resolution,
                    html: this.htmlContent,
                    transparent: true,
                    billboard: this.billboard,
                    onAnchorClick: (anchor) => {
                        console.log('Panel link clicked:', anchor.href);
                        window.open(anchor.href, '_blank');
                    }
                });
                
                // Reparent to this entity so it inherits rotation
                if (this._panel) {
                    this._panel.reparent(this.entity);
                    this._panel.setLocalPosition(0, this.offsetY, 0);
                    this._panel.setLocalEulerAngles(90, 0, 0);
                }
                
                console.log('TexturePanel: Created via ArrivalPluginUtils');
            } catch (err) {
                console.error('TexturePanel: Failed to create panel:', err);
            }
        } else {
            // Fallback: Create manually using renderedHTMLPlane
            console.log('TexturePanel: ArrivalPluginUtils not available, creating manually...');
            await this._createPanelManual();
        }
        
        this._isLoading = false;
    }
    
    async _createPanelManual() {
        const app = this.app;
        const pos = this.entity.getPosition();
        const pixelWidth = Math.round(this.panelWidth * this.resolution);
        const pixelHeight = Math.round(this.panelHeight * this.resolution);
        
        // Wrap HTML in full document
        const wrappedHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    html, body { 
                        width: ${pixelWidth}px; 
                        height: ${pixelHeight}px; 
                        overflow: hidden;
                        background: transparent;
                    }
                    .container {
                        width: 100%;
                        height: 100%;
                    }
                    a { cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="container">${this.htmlContent}</div>
            </body>
            </html>
        `;
        
        // Create entity as child of this.entity so it inherits rotation
        this._panel = new pc.Entity('TexturePanel');
        this.entity.addChild(this._panel);
        
        // Use LOCAL position/rotation since it's a child
        this._panel.setLocalPosition(0, this.offsetY, 0);
        this._panel.setLocalEulerAngles(90, 0, 0);
        this._panel.setLocalScale(this.panelWidth, 1, this.panelHeight);
        
        this._panel.addComponent('render', { type: 'plane' });
        this._panel.addComponent('collision', {
            type: 'box',
            halfExtents: new pc.Vec3(this.panelWidth / 2, 0.01, this.panelHeight / 2)
        });
        this._panel.addComponent('script');
        
        // Create scripts
        const htmlPlane = this._panel.script.create('renderedHTMLPlane');
        this._panel.script.create('clickableRender', {
            attributes: {
                maxDistance: 100,
                highlightOnTouch: false,
                enabledInXR: true
            }
        });
        
        if (htmlPlane) {
            htmlPlane.onAnchorClick = (anchor) => {
                console.log('Panel link clicked:', anchor.href);
                window.open(anchor.href, '_blank');
            };
            
            await htmlPlane.createAndLoad(wrappedHtml, pixelWidth, pixelHeight, { transparent: true });
            
            // Store updateContent method
            this._panel.updateContent = async (newHtml) => {
                const newWrapped = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            * { margin: 0; padding: 0; box-sizing: border-box; }
                            html, body { 
                                width: ${pixelWidth}px; 
                                height: ${pixelHeight}px; 
                                overflow: hidden;
                                background: transparent;
                            }
                            .container { width: 100%; height: 100%; }
                            a { cursor: pointer; }
                        </style>
                    </head>
                    <body>
                        <div class="container">${newHtml}</div>
                    </body>
                    </html>
                `;
                await htmlPlane.createAndLoad(newWrapped, pixelWidth, pixelHeight, { transparent: true });
            };
        }
        
        // Billboard mode
        if (this.billboard) {
            const camera = app.root.findByName('Camera');
            if (camera) {
                const tickHandler = () => {
                    if (this._panel && !this._panel._destroyed) {
                        this._panel.lookAt(camera.getPosition());
                        this._panel.rotateLocal(90, 180, 0);
                    }
                };
                app.on('update', tickHandler);
                this._panel.once('destroy', () => app.off('update', tickHandler));
            }
        }
    }
    
    async update(dt) {
        // Check if HTML content changed
        if (this.htmlContent !== this._lastHtmlContent) {
            if (this._panel?.updateContent) {
                await this._panel.updateContent(this.htmlContent);
            } else {
                await this._createPanel();
            }
            this._lastHtmlContent = this.htmlContent;
        }
        
        // Check if size changed (requires full rebuild)
        if (this.panelWidth !== this._lastWidth || this.panelHeight !== this._lastHeight) {
            await this._createPanel();
            this._lastWidth = this.panelWidth;
            this._lastHeight = this.panelHeight;
        }
        
        // Panel is a child of entity, so it automatically follows position/rotation
    }
}
