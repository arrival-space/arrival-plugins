const TestPlugin = pc.createScript('cliTestPlugin');

TestPlugin.prototype.initialize = function() {
    console.log('CLI Test Plugin loaded!');
    
    // Create a visible box
    const box = new pc.Entity('TestBox');
    box.addComponent('render', { type: 'box' });
    box.setLocalPosition(0, 1.5, 0);
    this.entity.addChild(box);
};

export { TestPlugin };
