/**
 * Hello World Plugin
 * 
 * The simplest possible Arrival.Space plugin.
 * Demonstrates basic property types and how they appear in the UI.
 * 
 * Property Type Mapping:
 * - string → EditText (single line input)
 * - string with \n → EditTextMultiline (multiline textarea)
 * - string #hex → EditColor (color picker)
 * - number → EditNumericalBold (slider/number input)
 * - boolean → EditToggle (toggle switch)
 * - {x, y, z} → EditVec3 (3 number inputs)
 */
export class HelloWorld extends ArrivalScript {
    static scriptName = 'helloWorld';
    
    // Example properties showing different types
    message = "Hello World!";
    
    static properties = {
        message: { title: 'Message' }
    };
    
    initialize() {
        console.log(`👋 ${this.message} from plugin on:`, this.entity.name);
    }
    
    onPropertyChanged(name, value) {
        if (name === 'message') {
            console.log(`👋 ${value}`);
        }
    }
}
