
`ifndef RAM_H
`define RAM_H

module RAM_sync(clk, addr, din, dout, we);
  
  parameter A = 10; // # of address bits
  parameter D = 8;  // # of data bits
  
  input  clk;		// clock
  input  [A-1:0] addr;	// address
  input  [D-1:0] din;	// data input
  output [D-1:0] dout;	// data output
  input  we;		// write enable
  
  reg [D-1:0] mem [1<<A]; // (1<<A)xD bit memory
  
  always @(posedge clk) begin
    if (we)		// if write enabled
      mem[addr] <= din;	// write memory from din
    dout <= mem[addr];	// read memory to dout (sync)
  end

endmodule

module RAM_async(clk, addr, din, dout, we);
  
  parameter A = 10; // # of address bits
  parameter D = 8;  // # of data bits
  
  input  clk;		// clock
  input  [A-1:0] addr;	// address
  input  [D-1:0] din;	// data input
  output [D-1:0] dout;	// data output
  input  we;		// write enable
  
  reg [D-1:0] mem [1<<A]; // (1<<A)xD bit memory
  
  always @(posedge clk) begin
    if (we)		// if write enabled
      mem[addr] <= din;	// write memory from din
  end

  assign dout = mem[addr]; // read memory to dout (async)

endmodule

module RAM_async_tristate(clk, addr, data, we);
  
  parameter A = 10; // # of address bits
  parameter D = 8;  // # of data bits
  
  input  clk;		// clock
  input  [A-1:0] addr;	// address
  inout  [D-1:0] data;	// data in/out
  input  we;		// write enable
  
  reg [D-1:0] mem [1<<A]; // (1<<A)xD bit memory
  
  always @(posedge clk) begin
    if (we)		 // if write enabled
      mem[addr] <= data; // write memory from data
  end

  assign data = !we ? mem[addr] : {D{1'bz}}; // read memory to data (async)

endmodule

`endif
