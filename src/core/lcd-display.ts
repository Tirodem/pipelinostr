/**
 * LCD Display Manager
 *
 * Manages a 20x4 I2C LCD display for showing PipeliNostr status.
 * Uses i2cset commands directly for hardware communication.
 *
 * Wiring (Raspberry Pi):
 *   VCC -> 5V (pin 4)
 *   GND -> GND (pin 6)
 *   SDA -> GPIO 2 (pin 3)
 *   SCL -> GPIO 3 (pin 5)
 *
 * Default I2C address: 0x27 (some modules use 0x3F)
 *
 * Prerequisites:
 *   sudo apt install i2c-tools
 *   Enable I2C: sudo raspi-config -> Interface Options -> I2C
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../persistence/logger.js';

const execAsync = promisify(exec);

// LCD dimensions
const LCD_COLS = 20;
const LCD_ROWS = 4;

// I2C LCD commands (HD44780 via PCF8574)
const LCD_BACKLIGHT = 0x08;
const LCD_ENABLE = 0x04;
const LCD_COMMAND = 0x00;
const LCD_DATA = 0x01;

// LCD initialization commands
const LCD_CLEAR = 0x01;
const LCD_HOME = 0x02;
const LCD_ENTRY_MODE = 0x06;
const LCD_DISPLAY_ON = 0x0C;
const LCD_FUNCTION_SET = 0x28; // 4-bit, 2 lines, 5x8 font

// Row addresses for 20x4 LCD
const LCD_ROW_OFFSETS = [0x00, 0x40, 0x14, 0x54];

export interface LcdConfig {
  enabled: boolean;
  i2c_bus?: number;
  i2c_address?: number;
  npub_names?: Record<string, string>;
}

class LcdDisplayManager {
  private config: LcdConfig = { enabled: false };
  private i2cBus: number = 1;
  private i2cAddress: number = 0x27;
  private connected: boolean = false;
  private currentLines: string[] = ['', '', '', ''];
  private idleTimeout: NodeJS.Timeout | null = null;
  private workflowActive: boolean = false;
  private backlight: boolean = true;

  async initialize(config: LcdConfig): Promise<void> {
    this.config = config;

    if (!config.enabled) {
      logger.info('[LCD] Display disabled in config');
      return;
    }

    this.i2cBus = config.i2c_bus ?? 1;
    this.i2cAddress = config.i2c_address ?? 0x27;

    try {
      // Test I2C connection
      await this.testConnection();

      // Initialize LCD
      await this.initLcd();

      this.connected = true;
      logger.info(
        { i2cBus: this.i2cBus, i2cAddress: `0x${this.i2cAddress.toString(16)}` },
        '[LCD] Display initialized'
      );

      // Show idle screen
      await this.showIdle();

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, '[LCD] Failed to initialize display (running without LCD)');
      this.connected = false;
    }
  }

  /**
   * Test I2C connection by reading from the device
   */
  private async testConnection(): Promise<void> {
    try {
      await execAsync(`i2cdetect -y ${this.i2cBus}`);
      // Check if device is present at address
      const result = await execAsync(`i2cget -y ${this.i2cBus} 0x${this.i2cAddress.toString(16)} 2>/dev/null`);
      if (!result.stdout.trim()) {
        throw new Error(`No device at address 0x${this.i2cAddress.toString(16)}`);
      }
    } catch {
      throw new Error(`I2C device not found at bus ${this.i2cBus}, address 0x${this.i2cAddress.toString(16)}`);
    }
  }

  /**
   * Initialize the LCD display
   */
  private async initLcd(): Promise<void> {
    // Wait for LCD to power up
    await this.delay(50);

    // Initialize in 4-bit mode
    await this.write4bits(0x03 << 4);
    await this.delay(5);
    await this.write4bits(0x03 << 4);
    await this.delay(5);
    await this.write4bits(0x03 << 4);
    await this.delay(1);
    await this.write4bits(0x02 << 4);

    // Configure LCD
    await this.sendCommand(LCD_FUNCTION_SET);
    await this.sendCommand(LCD_DISPLAY_ON);
    await this.sendCommand(LCD_CLEAR);
    await this.delay(2);
    await this.sendCommand(LCD_ENTRY_MODE);
  }

  /**
   * Write 4 bits to LCD
   */
  private async write4bits(value: number): Promise<void> {
    const data = value | (this.backlight ? LCD_BACKLIGHT : 0);
    await this.i2cWrite(data);
    await this.pulseEnable(data);
  }

  /**
   * Pulse the enable pin
   */
  private async pulseEnable(data: number): Promise<void> {
    await this.i2cWrite(data | LCD_ENABLE);
    await this.delay(0.5);
    await this.i2cWrite(data & ~LCD_ENABLE);
    await this.delay(0.5);
  }

  /**
   * Send a command to LCD
   */
  private async sendCommand(cmd: number): Promise<void> {
    await this.sendByte(cmd, LCD_COMMAND);
  }

  /**
   * Send a character to LCD
   */
  private async sendChar(char: number): Promise<void> {
    await this.sendByte(char, LCD_DATA);
  }

  /**
   * Send a byte (as two 4-bit nibbles)
   */
  private async sendByte(value: number, mode: number): Promise<void> {
    const high = (value & 0xF0) | mode;
    const low = ((value << 4) & 0xF0) | mode;
    await this.write4bits(high);
    await this.write4bits(low);
  }

  /**
   * Write to I2C device
   */
  private async i2cWrite(value: number): Promise<void> {
    try {
      await execAsync(`i2cset -y ${this.i2cBus} 0x${this.i2cAddress.toString(16)} ${value}`);
    } catch (error) {
      // Silently ignore write errors to avoid log spam
    }
  }

  /**
   * Set cursor position
   */
  private async setCursor(col: number, row: number): Promise<void> {
    const rowOffset = LCD_ROW_OFFSETS[row] ?? 0;
    const addr = rowOffset + col;
    await this.sendCommand(0x80 | addr);
  }

  /**
   * Write a string at current cursor position
   */
  private async writeString(text: string): Promise<void> {
    for (const char of text) {
      await this.sendChar(char.charCodeAt(0));
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Show idle screen (no workflow active)
   */
  async showIdle(): Promise<void> {
    if (!this.connected) return;

    this.workflowActive = false;
    await this.setLines([
      '',
      this.centerText('PipeliNostr'),
      '',
      this.centerText('Waiting to be awesome!')
    ]);
  }

  /**
   * Show workflow processing screen
   */
  async showProcessing(workflowName: string, triggerSource: string): Promise<void> {
    if (!this.connected) return;

    this.workflowActive = true;

    // Cancel any pending idle timeout
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    await this.setLines([
      this.centerText('Processing...'),
      this.truncateText(workflowName, LCD_COLS),
      this.truncateText(triggerSource, LCD_COLS),
      this.centerText('Wait for it!')
    ]);
  }

  /**
   * Show workflow completion briefly, then return to idle
   */
  async showComplete(success: boolean): Promise<void> {
    if (!this.connected) return;

    const statusLine = success ? 'Done!' : 'Failed!';

    // Update line 1 with status
    await this.setLine(0, this.centerText(statusLine));
    await this.setLine(3, '');

    // Return to idle after 3 seconds
    this.idleTimeout = setTimeout(() => {
      this.showIdle();
    }, 3000);
  }

  /**
   * Set all 4 lines at once
   */
  async setLines(lines: string[]): Promise<void> {
    if (!this.connected) return;

    for (let i = 0; i < LCD_ROWS; i++) {
      await this.setLine(i, lines[i] || '');
    }
  }

  /**
   * Set a single line
   */
  async setLine(row: number, text: string): Promise<void> {
    if (!this.connected || row < 0 || row >= LCD_ROWS) return;

    const paddedText = this.padText(text, LCD_COLS);

    // Only update if text changed
    if (this.currentLines[row] === paddedText) return;

    this.currentLines[row] = paddedText;

    await this.setCursor(0, row);
    await this.writeString(paddedText);
  }

  /**
   * Clear the display
   */
  async clear(): Promise<void> {
    if (!this.connected) return;

    await this.sendCommand(LCD_CLEAR);
    await this.delay(2);
    this.currentLines = ['', '', '', ''];
  }

  /**
   * Format trigger source for display
   * Converts npub to name or short format
   */
  formatTriggerSource(source: string | undefined): string {
    if (!source) return 'Manual';

    // Check if it's an npub
    if (source.startsWith('npub1')) {
      // Check for custom name mapping
      if (this.config.npub_names && this.config.npub_names[source]) {
        return this.config.npub_names[source];
      }
      // Use short format: first 8 + last 4 chars
      return `${source.slice(0, 8)}...${source.slice(-4)}`;
    }

    // HTTP trigger
    if (source === 'http' || source === 'webhook') {
      return 'HTTP';
    }

    // Hook trigger
    if (source === 'hook') {
      return 'Hook';
    }

    return source;
  }

  /**
   * Center text within LCD width
   */
  private centerText(text: string): string {
    if (text.length >= LCD_COLS) {
      return text.substring(0, LCD_COLS);
    }
    const padding = Math.floor((LCD_COLS - text.length) / 2);
    return ' '.repeat(padding) + text;
  }

  /**
   * Truncate text to fit LCD width
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Pad text to exact width (fill with spaces)
   */
  private padText(text: string, width: number): string {
    if (text.length >= width) {
      return text.substring(0, width);
    }
    return text + ' '.repeat(width - text.length);
  }

  /**
   * Check if LCD is connected and working
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set backlight on/off
   */
  async setBacklight(on: boolean): Promise<void> {
    this.backlight = on;
    if (this.connected) {
      await this.i2cWrite(on ? LCD_BACKLIGHT : 0);
    }
  }

  /**
   * Shutdown the LCD display
   */
  async shutdown(): Promise<void> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    if (this.connected) {
      // Show shutdown message
      await this.clear();
      await this.setLine(1, this.centerText('PipeliNostr'));
      await this.setLine(2, this.centerText('Shutting down...'));

      // Wait a bit for message to display
      await this.delay(500);

      this.connected = false;
      logger.info('[LCD] Display shutdown');
    }
  }
}

// Singleton instance
export const lcdDisplay = new LcdDisplayManager();
