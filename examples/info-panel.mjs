/**
 * Info Panel Plugin
 * 
 * Displays an HTML panel that always faces the camera (billboard).
 * Demonstrates ArrivalSpace.createHTMLPanel() and onPropertyChanged().
 * 
 * Features demonstrated:
 * - Hex color picker: backgroundColor uses #hex format → shows color picker in UI
 * - Multiline text: description contains \n → shows multiline editor in UI
 */
export class InfoPanel extends ArrivalScript {
    static scriptName = 'infoPanel';
    
    // Properties
    title = "Info";
    // Multiline string (contains \n) → will show EditTextMultiline in UI
    description = "This is an information panel.\nClick to learn more!";
    width = 1.5;
    height = 0.8;
    // Hex color string → will show EditColor picker in UI
    backgroundColor = "#1a1a2e";
    textColor = "#ffffff";
    
    static properties = {
        title: { title: 'Title' },
        description: { title: 'Description' },
        width: { title: 'Width', min: 0.5, max: 5 },
        height: { title: 'Height', min: 0.3, max: 3 },
        backgroundColor: { title: 'Background Color' },
        textColor: { title: 'Text Color' }
    };
    
    // Private
    _panel = null;
    
    initialize() {
        this._createPanel();
    }
    
    _createPanel() {
        // Remove old panel if exists
        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
        
        const pos = this.position;
        
        this._panel = ArrivalSpace.createHTMLPanel({
            position: { x: pos.x, y: pos.y, z: pos.z },
            width: this.width,
            height: this.height,
            html: this._getHTML(),
            backgroundColor: this.backgroundColor,
            textColor: this.textColor,
            billboard: true     // Always face camera
        });
    }
    
    _getHTML() {
        // Convert newlines in description to <br> for HTML display
        const descriptionHtml = this.description.replace(/\n/g, '<br>');
        return `
            <div style="
                padding: 20px;
                text-align: center;
            ">
                <h2 style="margin: 0 0 10px 0; font-size: 24px;">${this.title}</h2>
                <p style="margin: 0; font-size: 16px; opacity: 0.8;">${descriptionHtml}</p>
            </div>
        `;
    }
    
    // Called when any property is changed via the UI
    onPropertyChanged(name, value, oldValue) {
        // For size/color changes, recreate the panel
        if (name === 'width' || name === 'height' || name === 'backgroundColor' || name === 'textColor') {
            this._createPanel();
        } else {
            // For text changes, just update the content
            this._panel?.updateContent({ html: this._getHTML() });
        }
    }
    
    update(dt) {
        // Keep panel at entity position as it moves
        if (this._panel) {
            const pos = this.position;
            this._panel.setPosition(pos.x, pos.y, pos.z);
        }
    }
    
    // Clean up when destroyed
    destroy() {
        console.log("=== InfoPanel: Destroying panel ===");
        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
    }
}
