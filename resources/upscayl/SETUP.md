# Upscayl Binary Setup

FoolAI's AI Upscale mode uses the same `upscayl-bin` binary and NCNN models
that Upscayl ships. You need to copy them here manually.

## Step 1 — Download Upscayl portable

Go to: https://github.com/upscayl/upscayl/releases/latest
Download the **Windows portable zip** (e.g. `Upscayl-2.x.x-win-portable.zip`)

## Step 2 — Copy the binary

From the extracted zip, copy:

    <upscayl-portable>/resources/bin/upscayl-bin.exe
        → resources/upscayl/bin/upscayl-bin.exe

Also copy the two DLLs next to it:

    vcomp140.dll  → resources/upscayl/bin/vcomp140.dll
    vcomp140d.dll → resources/upscayl/bin/vcomp140d.dll

## Step 3 — Copy the models

From the extracted zip, copy ALL files from:

    <upscayl-portable>/resources/models/

Into:

    resources/upscayl/models/

The models are pairs of `.bin` + `.param` files:

    digital-art-4x.bin / .param
    high-fidelity-4x.bin / .param
    remacri-4x.bin / .param
    ultramix-balanced-4x.bin / .param
    ultrasharp-4x.bin / .param
    upscayl-lite-4x.bin / .param
    upscayl-standard-4x.bin / .param

## Final structure

    resources/upscayl/
    ├── bin/
    │   ├── upscayl-bin.exe
    │   ├── vcomp140.dll
    │   └── vcomp140d.dll
    └── models/
        ├── upscayl-standard-4x.bin
        ├── upscayl-standard-4x.param
        ├── ... (all 14 files)

Once in place, the green dot in FoolAI's Upscale screen will light up.
