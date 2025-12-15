declare module 'pigpio-client' {
  interface PigpioGpio {
    modeSet(mode: 'input' | 'output'): void;
    write(value: number): void;
    read(): Promise<number>;
    setServoPulsewidth(width: number): void;
    setPWMdutycycle(dutyCycle: number): void;
    setPWMfrequency(frequency: number): void;
  }

  interface PigpioClient {
    gpio(pin: number): PigpioGpio;
    end(): void;
    once(event: 'connected', callback: () => void): void;
    once(event: 'error', callback: (error: Error) => void): void;
  }

  interface PigpioOptions {
    host?: string;
    port?: number;
  }

  function pigpio(options?: PigpioOptions): PigpioClient;

  export { pigpio, PigpioClient, PigpioGpio, PigpioOptions };
}
