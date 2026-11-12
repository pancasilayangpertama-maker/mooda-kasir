package com.mooda.kasir;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * MoodaPrinter - cetak struk langsung ke printer thermal 58mm lewat Bluetooth
 * (SPP + ESC/POS), tanpa aplikasi perantara dan tanpa bridge di komputer.
 *
 * JS cukup mengirim data struk yang sudah berupa byte ESC/POS dalam base64.
 */
@CapacitorPlugin(
    name = "MoodaPrinter",
    permissions = {
        @Permission(
            alias = "bt",
            strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN }
        )
    }
)
public class MoodaPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private boolean hasPermission() {
        return !needsRuntimePermission() || getPermissionState("bt") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void devices(PluginCall call) {
        if (!hasPermission()) {
            requestPermissionForAlias("bt", call, "afterDevicesPermission");
            return;
        }
        listDevices(call);
    }

    @PermissionCallback
    private void afterDevicesPermission(PluginCall call) {
        if (hasPermission()) {
            listDevices(call);
        } else {
            call.reject("Izin Bluetooth ditolak. Buka Setelan > Aplikasi > MoodA > Izin.");
        }
    }

    private void listDevices(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Perangkat ini tidak punya Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth mati. Nyalakan dulu lalu coba lagi.");
            return;
        }
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            JSArray arr = new JSArray();
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() == null ? "Tanpa nama" : d.getName());
                o.put("address", d.getAddress());
                arr.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("devices", arr);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Izin Bluetooth belum diberikan.");
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || address.isEmpty()) {
            call.reject("Printer belum dipilih.");
            return;
        }
        if (data == null || data.isEmpty()) {
            call.reject("Data struk kosong.");
            return;
        }
        if (!hasPermission()) {
            requestPermissionForAlias("bt", call, "afterPrintPermission");
            return;
        }
        doPrint(call, address, data);
    }

    @PermissionCallback
    private void afterPrintPermission(PluginCall call) {
        if (hasPermission()) {
            doPrint(call, call.getString("address"), call.getString("data"));
        } else {
            call.reject("Izin Bluetooth ditolak.");
        }
    }

    private void doPrint(final PluginCall call, final String address, final String data) {
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.NO_WRAP);
        } catch (Exception e) {
            call.reject("Data struk tidak valid.");
            return;
        }
        new Thread(() -> {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Perangkat ini tidak punya Bluetooth.");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth mati. Nyalakan dulu lalu coba lagi.");
                return;
            }
            BluetoothSocket socket = null;
            try {
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                OutputStream out = socket.getOutputStream();
                final int chunk = 256;
                for (int i = 0; i < bytes.length; i += chunk) {
                    out.write(bytes, i, Math.min(chunk, bytes.length - i));
                    out.flush();
                    Thread.sleep(20);
                }
                out.flush();
                Thread.sleep(200);
                call.resolve();
            } catch (SecurityException e) {
                call.reject("Izin Bluetooth ditolak.");
            } catch (Exception e) {
                call.reject("Gagal cetak: " + e.getMessage());
            } finally {
                try {
                    if (socket != null) socket.close();
                } catch (Exception ignored) {
                }
            }
        }).start();
    }
}
